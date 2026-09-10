package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

const approvedTenant = "7d055c24-3a32-4d28-bac2-b512fa1423b6"

var approvedUsers = map[string]string{
	"erp:" + approvedTenant + ":3caf337c-0861-44c7-91d6-67418bda9e1c": "erp-seat-14bd95df458c396333d0ea679e5ee494@iam.invalid",
	"erp:" + approvedTenant + ":9055cdcd-07c9-4de0-a224-9f627e912e99": "erp-seat-efa0641531df01caec533554e1d0b8fe@iam.invalid",
}

const disabledPassword = "!erp-sso-password-disabled!"

var errRecovery = errors.New("recovery validation failed; no credential details are logged")

type accountInput struct {
	UserID   string `json:"userId"`
	Email    string `json:"email"`
	Password string `json:"password"`
}
type recoveryInput struct {
	Revision       int64          `json:"revision"`
	SnapshotSHA256 string         `json:"snapshotSHA256"`
	Accounts       []accountInput `json:"accounts"`
}

func (recoveryInput) String() string     { return "recoveryInput{REDACTED}" }
func (r recoveryInput) GoString() string { return r.String() }
func (accountInput) String() string      { return "accountInput{REDACTED}" }
func (r accountInput) GoString() string  { return r.String() }

type object map[string]json.RawMessage

func field(o object, key string) string   { var v string; _ = json.Unmarshal(o[key], &v); return v }
func put(o object, key string, value any) { o[key], _ = json.Marshal(value) }

// Work with raw fields, not a version-specific business struct: unknown fields
// and legacy map keys (including escaped NUL separators) must survive recovery.
func recoverSnapshot(raw []byte, input recoveryInput, now time.Time) ([]byte, error) {
	var root, users, sessions, audits object
	if json.Unmarshal(raw, &root) != nil || field(root, "erpTenantId") != approvedTenant || json.Unmarshal(root["users"], &users) != nil || users == nil || len(input.Accounts) != len(approvedUsers) {
		return nil, errRecovery
	}
	if len(root["sessions"]) > 0 && json.Unmarshal(root["sessions"], &sessions) != nil {
		return nil, errRecovery
	}
	if len(root["accountAuditLogs"]) > 0 && json.Unmarshal(root["accountAuditLogs"], &audits) != nil {
		return nil, errRecovery
	}
	if audits == nil {
		audits = object{}
	}
	seenIDs, seenEmails := map[string]bool{}, map[string]bool{}
	for _, a := range input.Accounts {
		var user object
		expected, ok := approvedUsers[a.UserID]
		email := strings.ToLower(strings.TrimSpace(a.Email))
		address, err := mail.ParseAddress(email)
		if !ok || seenIDs[a.UserID] || seenEmails[email] || err != nil || address.Address != email || !strings.Contains(email, "@") || strings.HasSuffix(email, ".invalid") || len(email) > 254 || strings.TrimSpace(a.Password) != a.Password || len(a.Password) < 12 || len(a.Password) > 72 {
			return nil, errRecovery
		}
		if json.Unmarshal(users[a.UserID], &user) != nil || field(user, "id") != a.UserID || field(user, "email") != expected || field(user, "passwordHash") != disabledPassword || field(user, "role") != "admin" || field(user, "status") != "active" {
			return nil, errRecovery
		}
		for id, value := range users {
			var other object
			if json.Unmarshal(value, &other) != nil {
				return nil, errRecovery
			}
			if id != a.UserID && strings.EqualFold(field(other, "email"), email) {
				return nil, errRecovery
			}
		}
		seenIDs[a.UserID] = true
		seenEmails[email] = true
	}
	for _, a := range input.Accounts {
		var user object
		_ = json.Unmarshal(users[a.UserID], &user)
		hash, err := bcrypt.GenerateFromPassword([]byte(a.Password), bcrypt.DefaultCost)
		if err != nil {
			return nil, errRecovery
		}
		put(user, "email", strings.ToLower(strings.TrimSpace(a.Email)))
		put(user, "passwordHash", string(hash))
		put(user, "updatedAt", now.UTC())
		users[a.UserID], _ = json.Marshal(user)
		id := uuid.NewString()
		event := map[string]any{"id": id, "actorUserId": "operator:ssh-native-recovery", "targetUserId": a.UserID, "action": "native_identity_recovered", "changes": map[string]bool{"loginUpdated": true, "passwordSet": true, "sessionsRevoked": true}, "createdAt": now.UTC()}
		audits[id], _ = json.Marshal(event)
	}
	for key, value := range sessions {
		var session object
		if json.Unmarshal(value, &session) != nil {
			return nil, errRecovery
		}
		if seenIDs[field(session, "userId")] {
			delete(sessions, key)
		}
	}
	put(root, "users", users)
	put(root, "sessions", sessions)
	put(root, "accountAuditLogs", audits)
	result, err := json.Marshal(root)
	if err != nil || bytes.Equal(result, raw) {
		return nil, errRecovery
	}
	return result, nil
}
