package agent

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html/template"
	"io"
	"log"
	"net"
	"net/http"
	"sync/atomic"
	"time"
)

type Config struct {
	HTTPListen        string `json:"http_listen"`
	TCPListen         string `json:"tcp_listen"`
	UDPListen         string `json:"udp_listen"`
	DataDir           string `json:"data_dir"`
	MaxBodyBytes      int64  `json:"max_body_bytes"`
	TCPAck            string `json:"tcp_ack"`
	AllowRemoteStatus bool   `json:"allow_remote_status"`
}

func (c *Config) ApplyDefaults() {
	if c.HTTPListen == "" {
		c.HTTPListen = "0.0.0.0:19091"
	}
	if c.TCPListen == "" {
		c.TCPListen = "0.0.0.0:19092"
	}
	if c.UDPListen == "" {
		c.UDPListen = "0.0.0.0:19093"
	}
	if c.DataDir == "" {
		c.DataDir = "./data"
	}
	if c.MaxBodyBytes <= 0 {
		c.MaxBodyBytes = 1024 * 1024
	}
}

type Server struct {
	config   Config
	store    *Store
	logger   *log.Logger
	received atomic.Uint64
}

func NewServer(config Config, store *Store, logger *log.Logger) *Server {
	config.ApplyDefaults()
	if logger == nil {
		logger = log.Default()
	}
	server := &Server{config: config, store: store, logger: logger}
	if store != nil {
		count, _, _, _ := store.Stats()
		server.received.Store(count)
	}
	return server
}

func (s *Server) HTTPHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/ks01", s.handleHTTPEvent)
	mux.HandleFunc("/ks01/", s.handleHTTPEvent)
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/status.json", s.handleStatusJSON)
	mux.HandleFunc("/status", s.handleStatus)
	return accessLog(s.logger, mux)
}

func (s *Server) handleHTTPEvent(w http.ResponseWriter, r *http.Request) {
	limited := io.LimitReader(r.Body, s.config.MaxBodyBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "read request body failed"})
		return
	}
	if int64(len(body)) > s.config.MaxBodyBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "request body is too large"})
		return
	}
	event := RawEvent{
		ID:         newID(),
		ReceivedAt: time.Now().UTC(),
		Source:     "http",
		RemoteAddr: r.RemoteAddr,
		Method:     r.Method,
		Path:       r.URL.Path,
		RequestURI: r.URL.RequestURI(),
		Headers:    r.Header.Clone(),
		BodyBase64: base64.StdEncoding.EncodeToString(body),
		BodyText:   string(body),
		BodyHex:    hex.EncodeToString(body),
	}
	if err := s.record(event); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store raw event failed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"accepted": true, "eventId": event.ID})
}

func (s *Server) ServeTCP(ctx context.Context) error {
	listener, err := net.Listen("tcp", s.config.TCPListen)
	if err != nil {
		return fmt.Errorf("listen TCP %s: %w", s.config.TCPListen, err)
	}
	defer listener.Close()
	s.logger.Printf("TCP receiver listening on %s", s.config.TCPListen)
	go func() {
		<-ctx.Done()
		_ = listener.Close()
	}()
	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			s.logger.Printf("accept TCP connection: %v", err)
			continue
		}
		go s.handleTCP(ctx, conn)
	}
}

func (s *Server) ServeUDP(ctx context.Context) error {
	addr, err := net.ResolveUDPAddr("udp", s.config.UDPListen)
	if err != nil {
		return fmt.Errorf("resolve UDP %s: %w", s.config.UDPListen, err)
	}
	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		return fmt.Errorf("listen UDP %s: %w", s.config.UDPListen, err)
	}
	defer conn.Close()
	s.logger.Printf("UDP receiver listening on %s", s.config.UDPListen)
	go func() {
		<-ctx.Done()
		_ = conn.Close()
	}()
	buffer := make([]byte, 64*1024)
	for {
		if err := conn.SetReadDeadline(time.Now().Add(30 * time.Second)); err != nil {
			return err
		}
		n, remote, err := conn.ReadFromUDP(buffer)
		if n > 0 {
			body := append([]byte(nil), buffer[:n]...)
			event := RawEvent{
				ID:         newID(),
				ReceivedAt: time.Now().UTC(),
				Source:     "udp",
				RemoteAddr: remote.String(),
				BodyBase64: base64.StdEncoding.EncodeToString(body),
				BodyText:   string(body),
				BodyHex:    hex.EncodeToString(body),
			}
			if recordErr := s.record(event); recordErr != nil {
				s.logger.Printf("store UDP event: %v", recordErr)
				continue
			}
		}
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				continue
			}
			s.logger.Printf("read UDP packet: %v", err)
		}
	}
}

func (s *Server) handleTCP(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	remote := conn.RemoteAddr().String()
	buffer := make([]byte, 64*1024)
	for {
		if err := conn.SetReadDeadline(time.Now().Add(30 * time.Second)); err != nil {
			return
		}
		n, err := conn.Read(buffer)
		if n > 0 {
			body := append([]byte(nil), buffer[:n]...)
			event := RawEvent{
				ID:         newID(),
				ReceivedAt: time.Now().UTC(),
				Source:     "tcp",
				RemoteAddr: remote,
				BodyBase64: base64.StdEncoding.EncodeToString(body),
				BodyText:   string(body),
				BodyHex:    hex.EncodeToString(body),
			}
			if recordErr := s.record(event); recordErr != nil {
				s.logger.Printf("store TCP event: %v", recordErr)
				return
			}
			if s.config.TCPAck != "" {
				if _, writeErr := conn.Write([]byte(s.config.TCPAck)); writeErr != nil {
					return
				}
			}
		}
		if err != nil {
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				if ctx.Err() != nil {
					return
				}
				continue
			}
			return
		}
	}
}

func (s *Server) record(event RawEvent) error {
	if err := s.store.Append(event); err != nil {
		return err
	}
	s.received.Add(1)
	return nil
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "received": s.received.Load()})
}

func (s *Server) handleStatusJSON(w http.ResponseWriter, r *http.Request) {
	if !s.statusAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "status is local-only"})
		return
	}
	count, last, recent, path := s.store.Stats()
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":             true,
		"received":       count,
		"lastReceivedAt": last,
		"dataFile":       path,
		"recent":         recent,
	})
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if !s.statusAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "status is local-only"})
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	count, last, recent, path := s.store.Stats()
	templateData := struct {
		Count  uint64
		Last   string
		Path   string
		Recent []RawEvent
	}{Count: count, Last: last.Format(time.RFC3339), Path: path, Recent: recent}
	if err := statusTemplate.Execute(w, templateData); err != nil {
		s.logger.Printf("render status: %v", err)
	}
}

func (s *Server) statusAllowed(r *http.Request) bool {
	if s.config.AllowRemoteStatus {
		return true
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func newID() string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err == nil {
		return hex.EncodeToString(bytes[:])
	}
	return fmt.Sprintf("%d", time.Now().UnixNano())
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func accessLog(logger *log.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		if logger != nil {
			logger.Printf("HTTP %s %s from %s in %s", r.Method, r.URL.Path, r.RemoteAddr, time.Since(started).Round(time.Millisecond))
		}
	})
}

var statusTemplate = template.Must(template.New("status").Parse(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KS-01 Agent 状态</title><style>body{font:14px system-ui,sans-serif;max-width:1100px;margin:32px auto;padding:0 16px;color:#222}h1{font-size:24px}.meta{display:flex;gap:24px;flex-wrap:wrap;margin:16px 0}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}code{word-break:break-all}</style></head>
<body><h1>KS-01 Agent 状态</h1><div class="meta"><span>已接收：<strong>{{.Count}}</strong> 条</span><span>最近接收：{{.Last}}</span><span>原始文件：<code>{{.Path}}</code></span></div>
<table><thead><tr><th>时间</th><th>来源</th><th>远端</th><th>请求</th><th>内容（文本 / HEX）</th></tr></thead><tbody>{{range .Recent}}<tr><td>{{.ReceivedAt}}</td><td>{{.Source}}</td><td>{{.RemoteAddr}}</td><td><code>{{.RequestURI}}</code></td><td><code>{{.BodyText}}</code><br><code>{{.BodyHex}}</code></td></tr>{{else}}<tr><td colspan="5">暂无报文</td></tr>{{end}}</tbody></table></body></html>`))
