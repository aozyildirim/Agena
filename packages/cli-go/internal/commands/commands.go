// Package commands is the command set for `agena`. Each command below
// is currently a skeleton that delegates to the Node CLI (packages/cli)
// until the Go port is complete.
//
// When porting a command, replace the stub body with the native Go
// implementation and drop the exec-nodecli fallback.
package commands

import (
	"fmt"
	"os"
	"os/exec"

	"github.com/spf13/cobra"

	"github.com/aozyildirim/Agena/packages/cli-go/internal/config"
)

func LoginCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "login",
		Short: "Authenticate against an Agena backend",
		RunE: func(cmd *cobra.Command, args []string) error {
			return execNodeCLI("login", args...)
		},
	}
	return cmd
}

func SetupCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "setup",
		Short: "Configure + authenticate + start the daemon in one step",
		RunE: func(cmd *cobra.Command, args []string) error {
			return execNodeCLI("setup", args...)
		},
	}
}

func DaemonCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "daemon",
		Short: "Manage the local CLI bridge daemon",
	}
	for _, sub := range []string{"start", "stop", "status", "logs"} {
		s := sub
		cmd.AddCommand(&cobra.Command{
			Use:   s,
			Short: "See `agena daemon " + s + " --help`",
			RunE: func(cmd *cobra.Command, args []string) error {
				return execNodeCLI("daemon", append([]string{s}, args...)...)
			},
		})
	}
	return cmd
}

func RuntimeCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "runtime",
		Short: "Inspect registered runtimes",
	}
	for _, sub := range []string{"list", "status"} {
		s := sub
		cmd.AddCommand(&cobra.Command{
			Use:   s + " [args]",
			Short: "See `agena runtime " + s + " --help`",
			RunE: func(cmd *cobra.Command, args []string) error {
				return execNodeCLI("runtime", append([]string{s}, args...)...)
			},
		})
	}
	return cmd
}

// ExecNodeCLI is the fallback — spawns the Node CLI bundled alongside
// this binary, forwarding args. The Homebrew formula lays the Node
// CLI down at the same prefix so this works transparently for brew
// users. Exported so `cmd/agena/main.go` can route unknown subcommands
// (e.g. `refinement`, `tasks`) here without first stub-registering
// them in cobra.
func ExecNodeCLI(sub string, args ...string) error {
	return execNodeCLI(sub, args...)
}

func execNodeCLI(sub string, args ...string) error {
	full := append([]string{sub}, args...)
	candidates := []string{
		// Same-prefix npm install: <prefix>/lib/node_modules/@agenaai/cli/bin/agena.js
		"/opt/homebrew/lib/node_modules/@agenaai/cli/bin/agena.js",
		"/usr/local/lib/node_modules/@agenaai/cli/bin/agena.js",
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			cmd := exec.Command("node", append([]string{c}, full...)...)
			cmd.Stdin = os.Stdin
			cmd.Stdout = os.Stdout
			cmd.Stderr = os.Stderr
			return cmd.Run()
		}
	}
	return fmt.Errorf("bundled @agenaai/cli not found — this Go binary is a thin shim for now.\n"+
		"Install the Node CLI: npm install -g @agenaai/cli\n(config dir: %s)", config.Dir())
}
