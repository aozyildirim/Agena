// Command agena is the native Go CLI for the AGENA platform.
//
// STATUS: scaffold. The Node CLI at packages/cli/ is the canonical
// implementation; this package exists so the Homebrew/GoReleaser
// publish path has a target to release. Each command currently delegates
// to the Node CLI via the shipped bridge-server.mjs path, so users
// installing via brew get the same behaviour without shipping a full
// Go rewrite yet.
//
// Migration plan: port one command per release starting with `login`
// (smallest surface area + security-critical) then `daemon` and
// `runtime`. Each ported command loses its Node dependency; once all
// three are ported the Node CLI is deprecated.
package main

import (
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/aozyildirim/Agena/packages/cli-go/internal/commands"
)

// goCommands lists the subcommands the Go CLI handles natively (or via
// its own cobra-registered shim). Anything else falls through to the
// Node CLI so we don't have to register a stub for every new top-level
// command (`refinement`, `tasks`, `flows`, ...). Add to this set when
// you port a command into Go.
var goCommands = map[string]bool{
	"login":      true,
	"setup":      true,
	"daemon":     true,
	"runtime":    true,
	"help":       true,
	"completion": true,
	"version":    true,
}

// Version is stamped by goreleaser at build time via -ldflags:
//
//	-X main.Version=v0.1.0 -X main.Commit=<sha> -X main.Date=<date>
var (
	Version = "dev"
	Commit  = ""
	Date    = ""
)

func main() {
	// Generic passthrough: if the first non-flag arg is not a Go-handled
	// subcommand, forward the whole arg list to the Node CLI. Done before
	// cobra so unknown commands don't trip "Error: unknown command".
	args := os.Args[1:]
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") && !goCommands[args[0]] {
		if err := commands.ExecNodeCLI(args[0], args[1:]...); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	root := &cobra.Command{
		Use:   "agena",
		Short: "Official CLI for the AGENA platform",
		Long: "Official CLI for AGENA — enroll your machine as a Runtime, " +
			"run the CLI bridge, and manage agents.",
		Version: fmt.Sprintf("%s (commit %s, built %s)", Version, Commit, Date),
		SilenceUsage: true,
	}

	root.AddCommand(commands.LoginCmd())
	root.AddCommand(commands.SetupCmd())
	root.AddCommand(commands.DaemonCmd())
	root.AddCommand(commands.RuntimeCmd())

	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
