include .devcontainer/Makefile

.PHONY: build clean

build:
	@node build.js

clean:
	@rm -rf dist
