# Homebrew formula template for `brew install aozyildirim/tap/agena`.
#
# This file is meant to live in a separate tap repo:
#   https://github.com/aozyildirim/homebrew-tap/blob/main/Formula/agena.rb
#
# GoReleaser (`brews:` section of .goreleaser.yaml) will update this
# formula automatically on every tagged release. You only need to edit
# it manually for the first release to bootstrap the tap.

class Agena < Formula
  desc "Official CLI for the AGENA platform"
  homepage "https://agena.dev"
  # Bumped by GoReleaser on each release.
  version "0.1.0"

  # Binaries are prebuilt by GoReleaser and uploaded to the GitHub
  # release assets. SHAs below are placeholders; GoReleaser rewrites
  # them on each bump.
  if OS.mac?
    if Hardware::CPU.arm?
      url "https://github.com/aozyildirim/Agena/releases/download/v#{version}/agena_#{version}_darwin_arm64.tar.gz"
      sha256 "PLACEHOLDER_DARWIN_ARM64_SHA256"
    else
      url "https://github.com/aozyildirim/Agena/releases/download/v#{version}/agena_#{version}_darwin_amd64.tar.gz"
      sha256 "PLACEHOLDER_DARWIN_AMD64_SHA256"
    end
  elsif OS.linux?
    if Hardware::CPU.arm?
      url "https://github.com/aozyildirim/Agena/releases/download/v#{version}/agena_#{version}_linux_arm64.tar.gz"
      sha256 "PLACEHOLDER_LINUX_ARM64_SHA256"
    else
      url "https://github.com/aozyildirim/Agena/releases/download/v#{version}/agena_#{version}_linux_amd64.tar.gz"
      sha256 "PLACEHOLDER_LINUX_AMD64_SHA256"
    end
  end

  license "MIT"

  depends_on "node" => :optional

  def install
    bin.install "agena"
  end

  def caveats
    <<~EOS
      For the full command set while the Go port is in progress, also run:

          npm install -g @agena/cli

      Once the Go-native rewrite lands the npm dependency will go away.
    EOS
  end

  test do
    assert_match "agena version", shell_output("#{bin}/agena --version")
  end
end
