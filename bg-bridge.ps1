# language: PowerShell/C#, file: bg-bridge.ps1, runtime: Windows PowerShell 5.1+, target: Windows 11
param(
  [int]$IncVk = 66,
  [int]$DecVk = 78,
  [int]$InitialCount = 0,
  [string]$Topic = "diogo_rt_counter_global_v2_global"
)

$ErrorActionPreference = 'Continue'

# Free port 31337 if an older bridge instance is holding it
Get-NetTCPConnection -LocalPort 31337 -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.OwningProcess -and $_.OwningProcess -ne $PID) {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

$code = @'
using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class KeyBridge {
    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int vKey);

    public static volatile int IncVk = 66;
    public static volatile int DecVk = 78;
    public static int Count = 0;
    public static string Topic = "diogo_rt_counter_global_v2_global";

    private static ConcurrentDictionary<int, Stream> clients = new ConcurrentDictionary<int, Stream>();
    private static int nextId = 0;
    private static int dirty = 0;

    public static void Start(int port, int inc, int dec, int startCount, string topic) {
        IncVk = inc;
        DecVk = dec;
        Count = startCount;
        Topic = topic;
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        ServicePointManager.DefaultConnectionLimit = 10;

        new Thread(KeyLoop) { IsBackground = true }.Start();
        new Thread(CloudSyncLoop) { IsBackground = true }.Start();

        TcpListener listener = new TcpListener(IPAddress.Loopback, port);
        listener.Start();
        Console.WriteLine("[OK] Captura em 2o plano rodando na porta " + port + " | Contador inicial: " + Count);
        while (true) {
            try {
                TcpClient client = listener.AcceptTcpClient();
                ThreadPool.QueueUserWorkItem(HandleClient, client);
            } catch { Thread.Sleep(50); }
        }
    }

    private static void KeyLoop() {
        bool prevInc = false;
        bool prevDec = false;
        while (true) {
            bool isInc = (GetAsyncKeyState(IncVk) & 0x8000) != 0;
            bool isDec = (GetAsyncKeyState(DecVk) & 0x8000) != 0;

            if (isInc && !prevInc) {
                int c = Interlocked.Increment(ref Count);
                Console.WriteLine("[+1] Contador: " + c);
                Broadcast("{\"delta\":1,\"count\":" + c + "}");
                Interlocked.Exchange(ref dirty, 1);
            }
            if (isDec && !prevDec) {
                int c = Count > 0 ? Interlocked.Decrement(ref Count) : 0;
                if (c < 0) { Count = 0; c = 0; }
                Console.WriteLine("[-1] Contador: " + c);
                Broadcast("{\"delta\":-1,\"count\":" + c + "}");
                Interlocked.Exchange(ref dirty, 1);
            }

            prevInc = isInc;
            prevDec = isDec;
            Thread.Sleep(8);
        }
    }

    private static void CloudSyncLoop() {
        while (true) {
            if (Interlocked.Exchange(ref dirty, 0) == 1) {
                int c = Count;
                try {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create("https://ntfy.sh/" + Topic);
                    req.Method = "POST";
                    req.Timeout = 4000;
                    byte[] body = Encoding.UTF8.GetBytes("{\"count\":" + c + ",\"ts\":" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + "}");
                    req.ContentLength = body.Length;
                    using (Stream s = req.GetRequestStream()) { s.Write(body, 0, body.Length); }
                    using (WebResponse r = req.GetResponse()) {}
                } catch {}
            }
            Thread.Sleep(60);
        }
    }

    private static void Broadcast(string json) {
        byte[] msg = Encoding.UTF8.GetBytes("data: " + json + "\n\n");
        foreach (var kv in clients) {
            try {
                kv.Value.Write(msg, 0, msg.Length);
                kv.Value.Flush();
            } catch {
                Stream removed;
                clients.TryRemove(kv.Key, out removed);
            }
        }
    }

    private static void HandleClient(object obj) {
        TcpClient client = (TcpClient)obj;
        try {
            NetworkStream stream = client.GetStream();
            byte[] buf = new byte[1024];
            int read = stream.Read(buf, 0, buf.Length);
            if (read <= 0) { client.Close(); return; }
            string req = Encoding.ASCII.GetString(buf, 0, read);
            string firstLine = req.Split('\r', '\n')[0];

            if (firstLine.StartsWith("OPTIONS ")) {
                string resp = "HTTP/1.1 204 No Content\r\n" +
                              "Access-Control-Allow-Origin: *\r\n" +
                              "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
                              "Access-Control-Allow-Headers: *\r\n" +
                              "Access-Control-Allow-Private-Network: true\r\n\r\n";
                byte[] b = Encoding.ASCII.GetBytes(resp);
                stream.Write(b, 0, b.Length);
                client.Close();
                return;
            }

            if (firstLine.Contains("/config?")) {
                int qIdx = firstLine.IndexOf("/config?") + 8;
                int endIdx = firstLine.IndexOf(' ', qIdx);
                string qs = endIdx > qIdx ? firstLine.Substring(qIdx, endIdx - qIdx) : "";
                foreach (string part in qs.Split('&')) {
                    string[] kv = part.Split('=');
                    if (kv.Length == 2) {
                        int v;
                        if (int.TryParse(kv[1], out v) && v >= 0) {
                            if (kv[0] == "inc" && v > 0 && v < 256) IncVk = v;
                            if (kv[0] == "dec" && v > 0 && v < 256) DecVk = v;
                            if (kv[0] == "count") Count = v;
                        }
                    }
                }
                string body = "{\"ok\":true,\"inc\":" + IncVk + ",\"dec\":" + DecVk + ",\"count\":" + Count + "}";
                string resp = "HTTP/1.1 200 OK\r\n" +
                              "Content-Type: application/json\r\n" +
                              "Access-Control-Allow-Origin: *\r\n" +
                              "Access-Control-Allow-Private-Network: true\r\n" +
                              "Content-Length: " + body.Length + "\r\n\r\n" + body;
                byte[] b = Encoding.ASCII.GetBytes(resp);
                stream.Write(b, 0, b.Length);
                client.Close();
                return;
            }

            if (firstLine.Contains("/events")) {
                string headers = "HTTP/1.1 200 OK\r\n" +
                                 "Content-Type: text/event-stream\r\n" +
                                 "Cache-Control: no-cache\r\n" +
                                 "Connection: keep-alive\r\n" +
                                 "Access-Control-Allow-Origin: *\r\n" +
                                 "Access-Control-Allow-Private-Network: true\r\n\r\n" +
                                 "data: {\"connected\":true,\"count\":" + Count + "}\n\n";
                byte[] b = Encoding.ASCII.GetBytes(headers);
                stream.Write(b, 0, b.Length);
                stream.Flush();
                int id = Interlocked.Increment(ref nextId);
                clients[id] = stream;
                return;
            }

            client.Close();
        } catch {
            try { client.Close(); } catch {}
        }
    }
}
'@

Add-Type -TypeDefinition $code -Language CSharp
[KeyBridge]::Start(31337, $IncVk, $DecVk, $InitialCount, $Topic)
