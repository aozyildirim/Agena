// Package config mirrors packages/cli/src/config.ts — same file layout
// (~/.agena/config.json) + same keychain service key, so a user can
// alternate between the Node and Go CLIs without re-logging in.
package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/zalando/go-keyring"
)

const (
	servicePrefix = "agena-cli"
	keyringAcct   = "jwt"
)

type Config struct {
	BackendURL  string `json:"backend_url"`
	TenantSlug  string `json:"tenant_slug"`
	JWT         string `json:"-"` // never marshalled to disk
	RuntimeName string `json:"runtime_name,omitempty"`
	UpdatedAt   string `json:"updated_at,omitempty"`
}

// Paths

func Dir() string { return filepath.Join(homeDir(), ".agena") }
func Path() string { return filepath.Join(Dir(), "config.json") }

func homeDir() string {
	if h, err := os.UserHomeDir(); err == nil {
		return h
	}
	return os.Getenv("HOME")
}

// Load reads config.json and hydrates the JWT from the OS keychain
// (macOS Keychain / Windows Credential Manager / libsecret).
func Load() (*Config, error) {
	cfg := &Config{BackendURL: "https://api.agena.dev"}
	raw, err := os.ReadFile(Path())
	if err == nil {
		if uerr := json.Unmarshal(raw, cfg); uerr != nil {
			return nil, uerr
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if cfg.BackendURL != "" {
		if jwt, err := keyring.Get(serviceFor(cfg.BackendURL), keyringAcct); err == nil {
			cfg.JWT = jwt
		}
	}
	return cfg, nil
}

// Save persists backend/tenant/etc to the config file and (if provided)
// writes the JWT to the OS keychain. JWT is never written to disk.
func Save(cfg *Config, jwt string) error {
	if err := os.MkdirAll(Dir(), 0o700); err != nil {
		return err
	}
	if jwt != "" {
		if err := keyring.Set(serviceFor(cfg.BackendURL), keyringAcct, jwt); err != nil {
			return err
		}
	}
	// Strip JWT before marshalling (json:"-" already does this but be explicit)
	out := *cfg
	out.JWT = ""
	buf, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(Path(), buf, 0o600)
}

func MaskJWT(j string) string {
	if j == "" {
		return "(not set)"
	}
	if len(j) <= 16 {
		return "***"
	}
	return j[:8] + "..." + j[len(j)-6:]
}

func serviceFor(backend string) string {
	clean := strings.ToLower(strings.TrimRight(strings.TrimPrefix(strings.TrimPrefix(backend, "https://"), "http://"), "/"))
	return servicePrefix + ":" + clean
}
