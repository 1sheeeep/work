package main

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/bcrypt"
)

func fixture(t *testing.T) ([]byte, recoveryInput) {
	t.Helper()
	users := map[string]any{}
	accounts := []accountInput{}
	i := 0
	for id, email := range approvedUsers {
		i++
		users[id] = map[string]any{"id": id, "email": email, "passwordHash": disabledPassword, "role": "admin", "status": "active", "permissions": []string{"workbench.access"}, "shopScopeIds": []string{"existing-shop"}, "unknownFutureField": map[string]any{"keep": true}}
		accounts = append(accounts, accountInput{id, fmt.Sprintf("user%d@example.test", i), "synthetic-test-password"})
	}
	root := map[string]any{"erpTenantId": approvedTenant, "users": users, "sessions": map[string]any{"mine": map[string]any{"userId": accounts[0].UserID, "tokenHash": "synthetic-session"}, "other": map[string]any{"userId": "unrelated-user"}}, "shops": map[string]any{"shop": map[string]any{"id": "existing-shop"}}, "shopAgents": map[string]any{"shop\x00user": map[string]any{"shopId": "existing-shop"}}, "unknownRoot": map[string]any{"number": json.Number("9007199254740993")}}
	raw, err := json.Marshal(root)
	if err != nil {
		t.Fatal(err)
	}
	return raw, recoveryInput{Accounts: accounts}
}

func TestRecoveryPreservesAllBusinessFieldsAndClearsOnlyTargetSessions(t *testing.T) {
	raw, input := fixture(t)
	now := time.Now().UTC()
	result, err := recoverSnapshot(raw, input, now)
	if err != nil {
		t.Fatal(err)
	}
	var before, after object
	_ = json.Unmarshal(raw, &before)
	_ = json.Unmarshal(result, &after)
	for key, value := range before {
		if key != "users" && key != "sessions" && key != "accountAuditLogs" && !reflect.DeepEqual(value, after[key]) {
			t.Fatalf("business field changed: %s", key)
		}
	}
	var users, oldUsers, sessions, audits object
	_ = json.Unmarshal(after["users"], &users)
	_ = json.Unmarshal(before["users"], &oldUsers)
	_ = json.Unmarshal(after["sessions"], &sessions)
	_ = json.Unmarshal(after["accountAuditLogs"], &audits)
	if len(sessions) != 1 || sessions["other"] == nil || len(audits) != 2 {
		t.Fatal("session or audit boundaries incorrect")
	}
	for _, a := range input.Accounts {
		var user, old object
		_ = json.Unmarshal(users[a.UserID], &user)
		_ = json.Unmarshal(oldUsers[a.UserID], &old)
		if field(user, "email") != a.Email || bcrypt.CompareHashAndPassword([]byte(field(user, "passwordHash")), []byte(a.Password)) != nil {
			t.Fatal("native login credential invalid")
		}
		for key, value := range old {
			if key != "email" && key != "passwordHash" && key != "updatedAt" && !reflect.DeepEqual(value, user[key]) {
				t.Fatalf("account field changed: %s", key)
			}
		}
	}
	if strings.Contains(string(result), input.Accounts[0].Password) {
		t.Fatal("plaintext password persisted")
	}
	if _, err = recoverSnapshot(result, input, now); err == nil {
		t.Fatal("recovery replay reset an already recovered account")
	}
}

func TestRecoveryRejectsInvalidPlansAtomically(t *testing.T) {
	for _, scenario := range []string{"one-account", "duplicate-id", "duplicate-email", "wrong-id", "invalid-email", "placeholder-email", "short-password", "long-password", "trimmed-password", "wrong-tenant", "already-native", "disabled-user", "changed-role", "corrupt-sessions"} {
		t.Run(scenario, func(t *testing.T) {
			raw, input := fixture(t)
			var root, users, user object
			_ = json.Unmarshal(raw, &root)
			_ = json.Unmarshal(root["users"], &users)
			_ = json.Unmarshal(users[input.Accounts[0].UserID], &user)
			switch scenario {
			case "one-account":
				input.Accounts = input.Accounts[:1]
			case "duplicate-id":
				input.Accounts[1].UserID = input.Accounts[0].UserID
			case "duplicate-email":
				input.Accounts[1].Email = input.Accounts[0].Email
			case "wrong-id":
				input.Accounts[0].UserID = "another-user"
			case "invalid-email":
				input.Accounts[0].Email = "Display <user@example.test>"
			case "placeholder-email":
				input.Accounts[0].Email = "seat@iam.invalid"
			case "short-password":
				input.Accounts[0].Password = "short"
			case "long-password":
				input.Accounts[0].Password = strings.Repeat("a", 73)
			case "trimmed-password":
				input.Accounts[0].Password = "  synthetic-test-password"
			case "wrong-tenant":
				put(root, "erpTenantId", "different-tenant")
			case "already-native":
				put(user, "passwordHash", "existing-hash")
			case "disabled-user":
				put(user, "status", "disabled")
			case "changed-role":
				put(user, "role", "agent")
			case "corrupt-sessions":
				root["sessions"] = json.RawMessage(`[]`)
			}
			if scenario == "already-native" || scenario == "disabled-user" || scenario == "changed-role" {
				put(users, input.Accounts[0].UserID, user)
				put(root, "users", users)
			}
			raw, _ = json.Marshal(root)
			before := string(raw)
			result, err := recoverSnapshot(raw, input, time.Now())
			if err == nil || result != nil || string(raw) != before {
				t.Fatal("invalid input partially applied")
			}
		})
	}
}

func TestRecoveryInputFormattingIsRedacted(t *testing.T) {
	_, input := fixture(t)
	if strings.Contains(fmt.Sprintf("%v %#v", input, input), "synthetic-test-password") {
		t.Fatal("credential formatting leaked")
	}
}
