# language: PowerShell/C#, file: bg-bridge.ps1, runtime: Windows PowerShell 5.1+, target: Windows 11
$ErrorActionPreference = 'SilentlyContinue'

$code = @"
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

    public static volatile int IncVk = 32;  // Space
    public static volatile int DecVk = 189; // Minus
    private static ConcurrentDictionary<int, Stream> clients = new ConcurrentDictionary<int, Stream>();
    private static int nextId = 0;

    public static void Start(int port) {
        Thread keyThread = new Thread(KeyLoop) { IsBackground = true };
        keyThread.Start();

        TcpListener listener = new TcpListener(IPAddress.Loopback, port);
        listener.Start();
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

            if (isInc && !prevInc) Broadcast("{\"delta\":1}");
            if (isDec && !prevDec) Broadcast("{\"delta\":-1}");

            prevInc = isInc;
            prevDec = isDec;
            Thread.Sleep(8);
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
                        if (int.TryParse(kv[1], out v) && v > 0 && v < 256) {
                            if (kv[0] == "inc") IncVk = v;
                            if (kv[0] == "dec") DecVk = v;
                        }
                    }
                }
                string body = "{\"ok\":true,\"inc\":" + IncVk + ",\"dec\":" + DecVk + "}";
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
                                 "data: {\"connected\":true}\n\n";
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
"@

Add-Type -TypeDefinition $code -Language CSharp
[KeyBridge]::Start(31337)
