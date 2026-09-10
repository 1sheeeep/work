package agent

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// RawEvent is deliberately protocol-neutral. The body is retained as base64 so
// binary data and unknown character encodings can be inspected later.
type RawEvent struct {
	ID         string              `json:"id"`
	ReceivedAt time.Time           `json:"receivedAt"`
	Source     string              `json:"source"`
	RemoteAddr string              `json:"remoteAddr,omitempty"`
	Method     string              `json:"method,omitempty"`
	Path       string              `json:"path,omitempty"`
	RequestURI string              `json:"requestUri,omitempty"`
	Headers    map[string][]string `json:"headers,omitempty"`
	BodyBase64 string              `json:"bodyBase64"`
	BodyText   string              `json:"bodyText,omitempty"`
	BodyHex    string              `json:"bodyHex"`
}

type Store struct {
	mu       sync.Mutex
	path     string
	file     *os.File
	count    uint64
	last     time.Time
	lastSeen []RawEvent
}

func OpenStore(dataDir string) (*Store, error) {
	if dataDir == "" {
		return nil, fmt.Errorf("data_dir is required")
	}
	if err := os.MkdirAll(dataDir, 0700); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}
	path := filepath.Join(dataDir, "raw-events.ndjson")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return nil, fmt.Errorf("open raw event file: %w", err)
	}
	count, lastSeen, last, err := loadRecent(path)
	if err != nil {
		file.Close()
		return nil, err
	}
	return &Store{path: path, file: file, count: count, last: last, lastSeen: lastSeen}, nil
}

func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.file == nil {
		return nil
	}
	err := s.file.Close()
	s.file = nil
	return err
}

func (s *Store) Append(event RawEvent) error {
	line, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("encode raw event: %w", err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.file == nil {
		return fmt.Errorf("raw event store is closed")
	}
	if _, err := s.file.Write(append(line, '\n')); err != nil {
		return fmt.Errorf("write raw event: %w", err)
	}
	if err := s.file.Sync(); err != nil {
		return fmt.Errorf("sync raw event: %w", err)
	}
	s.count++
	s.last = event.ReceivedAt
	s.lastSeen = append(s.lastSeen, event)
	if len(s.lastSeen) > 20 {
		s.lastSeen = s.lastSeen[len(s.lastSeen)-20:]
	}
	return nil
}

func (s *Store) Stats() (uint64, time.Time, []RawEvent, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	recent := append([]RawEvent(nil), s.lastSeen...)
	return s.count, s.last, recent, s.path
}

func loadRecent(path string) (uint64, []RawEvent, time.Time, error) {
	file, err := os.Open(path)
	if err != nil {
		return 0, nil, time.Time{}, fmt.Errorf("read raw event file: %w", err)
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	// A device payload may be larger than Scanner's default token size.
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	var count uint64
	var recent []RawEvent
	var last time.Time
	for scanner.Scan() {
		count++
		var event RawEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			return 0, nil, time.Time{}, fmt.Errorf("decode raw event line %d: %w", count, err)
		}
		last = event.ReceivedAt
		recent = append(recent, event)
		if len(recent) > 20 {
			recent = recent[len(recent)-20:]
		}
	}
	if err := scanner.Err(); err != nil {
		return 0, nil, time.Time{}, fmt.Errorf("scan raw event file: %w", err)
	}
	return count, recent, last, nil
}
