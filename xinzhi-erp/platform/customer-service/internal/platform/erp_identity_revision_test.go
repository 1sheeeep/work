package platform

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func TestIdentityRevisionPersistsAcrossFileRestartWithoutPublicExposure(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "owned-identity.json")
	store, err := OpenFileStore(path)
	if err != nil {
		t.Fatal(err)
	}
	user, err := store.CreateUser(ctx, User{ID: "owned-identity", Email: "owned@example.invalid", DisplayName: "Owned", Role: UserRoleAgent, PasswordHash: "synthetic-only"})
	if err != nil {
		t.Fatal(err)
	}
	for _, status := range []string{UserStatusDisabled, UserStatusActive} {
		if _, err = store.UpdateUser(ctx, user.ID, User{Status: status}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = store.SetUserReceptionOnline(ctx, user.ID, false); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenFileStore(path)
	if err != nil {
		t.Fatal(err)
	}
	current, err := reopened.ReadIdentitySnapshot(ctx, user.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.IdentityRevision != 2 || current.Status != UserStatusActive || current.ReceptionOnline {
		t.Fatal("identity revision or native state did not survive restart")
	}
	data, err := json.Marshal(current)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "identityRevision") || strings.Contains(string(data), "synthetic-only") {
		t.Fatal("internal authentication state leaked into public user JSON")
	}
}
