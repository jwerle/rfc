
BIN ?= rfc
NODE_MODULES = ./node_modules
PREFIX ?= /usr/local
MANPREFIX ?= $(PREFIX)/share/man/man1
MANPAGE = $(BIN).1

$(BIN): build test

build:
	npm i

install: man
	npm link

man:
	install $(MANPAGE) $(MANPREFIX)

doc:
	curl -# -F page=@$(BIN).1.md -o $(BIN).1 http://mantastic.herokuapp.com

uninstall:
	npm unlink

test:
	node test.js

clean:
	rm -rf $(NODE_MODULES)

.PHONY: test
