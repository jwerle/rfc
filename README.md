rfc(1)
=====

[IETF](http://www.ietf.org) [RFC](http://www.ietf.org/rfc) reader tool

## installl

with **npm**

```sh
$ npm install rfc -g
```

with **git**

```sh
$ git clone git@github.com:jwerle/rfc.git
$ cd rfc/
$ make
$ make install
```

## usage

**search** 

```sh
$ rfc search punycode
  ... searching

  3492   Punycode: A Bootstring encoding of Unicode for Internationalized
         Domain Names in Applications (IDNA). A. Costello. March 2003.
         (Format: TXT=67439 bytes) (Updated by RFC5891) (Status: PROPOSED
         STANDARD)

  1 result
```

**view**

```sh
$ rfc open 3492

Network Working Group                                        A. Costello
Request for Comments: 3492                 Univ. of California, Berkeley
Category: Standards Track                                     March 2003


              Punycode: A Bootstring encoding of Unicode
       for Internationalized Domain Names in Applications (IDNA)

Status of this Memo

   This document specifies an Internet standards track protocol for the
   Internet community, and requests discussion and suggestions for
   improvements.  Please refer to the current edition of the "Internet
   Official Protocol Standards" (STD 1) for the standardization state
   and status of this protocol.  Distribution of this memo is unlimited.

Copyright Notice

   Copyright (C) The Internet Society (2003).  All Rights Reserved.

Abstract

   Punycode is a simple and efficient transfer encoding syntax designed
   for use with Internationalized Domain Names in Applications (IDNA).
   It uni

...
```

### module

```js
var rfc = require('rfc')

var count = 0;
rfc.search('punycode')
.on('error', function (err) {
  // handle error
})
.on('result', function (result) {
  count++;
  console.log("  %d %s", result.rfc, result.desc);
})
.on('end', function () {
  console.log("  got %d result(s)", count);
});
```

## api

### RFC\_BASE\_URL

IETF RFC Base URL


### RFC\_INDEX\_URL

IETF RFC Index file URL

### RFC\_CACHE

Default RFC cache

### RFC\_CACHE\_INDEX

Default RFC Index cache file name

### sync()

Sync RFC Index file to a local file (`RFC_CACHE_INDEX`) in a directory
defined by the environment variable `RFC_CACHE`.

`sync()` returns a stream that is readable.

```js
rfc.sync()
.on('data', function (chunk) {
  console.log(chunk)
});
```

### search(query)

Searches RFC Index based on a query

```js
rfc.search('idna')
.on('result', function (result) {
  console.log("%d (%s) %s",
    result.rfc,
    result.path,
    result.desc);
});
```

## license

MIT
