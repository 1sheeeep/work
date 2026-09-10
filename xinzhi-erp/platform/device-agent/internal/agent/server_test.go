package agent

import (
	"context"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHTTPEventIsStoredAsRawPayload(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	server := NewServer(Config{MaxBodyBytes: 1024}, store, log.New(io.Discard, "", 0))

	req := httptest.NewRequest(http.MethodPost, "/ks01", strings.NewReader("{\"barcode\":\"ABC\",\"weight\":123}"))
	rec := httptest.NewRecorder()
	server.HTTPHandler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	count, _, recent, _ := store.Stats()
	if count != 1 || len(recent) != 1 {
		t.Fatalf("stored count = %d, recent = %d", count, len(recent))
	}
	if recent[0].BodyText != "{\"barcode\":\"ABC\",\"weight\":123}" {
		t.Fatalf("body text = %q", recent[0].BodyText)
	}
	if recent[0].BodyHex == "" || recent[0].BodyBase64 == "" {
		t.Fatal("raw encodings were not retained")
	}
}

func TestHTTPEventRejectsOversizedPayload(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	server := NewServer(Config{MaxBodyBytes: 3}, store, log.New(io.Discard, "", 0))
	req := httptest.NewRequest(http.MethodPost, "/ks01", strings.NewReader("1234"))
	rec := httptest.NewRecorder()
	server.HTTPHandler().ServeHTTP(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d", rec.Code)
	}
	count, _, _, _ := store.Stats()
	if count != 0 {
		t.Fatalf("oversized payload was stored: %d", count)
	}
}

func TestStoreReopensAndCountsExistingEvents(t *testing.T) {
	dir := t.TempDir()
	first, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Append(RawEvent{ID: "one", BodyText: "payload"}); err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	second, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	count, _, recent, _ := second.Stats()
	if count != 1 || len(recent) != 1 || recent[0].ID != "one" {
		t.Fatalf("reopened store = count %d, recent %+v", count, recent)
	}
}

func TestStatusIsLocalOnlyByDefault(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	server := NewServer(Config{}, store, log.New(io.Discard, "", 0))
	req := httptest.NewRequest(http.MethodGet, "/status.json", nil)
	req.RemoteAddr = "192.168.1.20:1234"
	rec := httptest.NewRecorder()
	server.HTTPHandler().ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestUDPReceiverStoresPacket(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	conn, err := net.ListenPacket("udp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := conn.LocalAddr().String()
	conn.Close()

	server := NewServer(Config{UDPListen: addr}, store, log.New(io.Discard, "", 0))
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = server.ServeUDP(ctx)
	}()

	client, err := net.Dial("udp", addr)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := client.Write([]byte("ABC,42,g")); err != nil {
			t.Fatal(err)
		}
		count, _, recent, _ := store.Stats()
		if count > 0 && len(recent) > 0 && recent[len(recent)-1].BodyText == "ABC,42,g" {
			client.Close()
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	client.Close()
	count, _, recent, _ := store.Stats()
	t.Fatalf("UDP packet was not stored, count %d recent %+v", count, recent)
}
