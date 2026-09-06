# Dependency license audit

Audited the locked dependency tree and installed license texts. The five direct
runtime dependencies and their installed dependency closure declare MIT. Copies
of their notices are retained in THIRD_PARTY_NOTICES.md, including the upstream
Hugeicons free-icon clarification. No Pro icon pack is installed.

The SDK npm package omits license metadata/text. Its package repository points
to get-bb/bb; BB root LICENSE is MIT at both vendored registry tags
(desktop-v0.40.0 and desktop-v0.41.0) and the reviewed current upstream source.
Vendored BB/shadcn notices are preserved separately from the project MIT license.

MPL-2.0 entries belong to lightningcss and platform binaries in the development
CSS toolchain. These binaries are not committed or distributed in the source Git
release. Their presence does not relicense original plugin source. If distributing
those binaries or modified MPL source later, preserve the applicable license and
source-availability obligations. Apache/BSD/ISC/dual-license dependencies retain
their own terms. No dependency was identified as non-redistributable in this audit.

`npm ci` reported zero known vulnerabilities for both clean installations. This
is a registry advisory check, not a comprehensive security scan.

Sources:
- https://github.com/get-bb/bb/blob/main/LICENSE
- https://github.com/hugeicons/hugeicons/blob/main/LICENSE.md
- https://github.com/shadcn-ui/ui/blob/main/LICENSE.md

The following is a lockfile inventory, including platform alternatives that are
not installed on this machine. Runtime/peer labels reflect npm lockfile flags;
they do not imply every package is included in the compiled bundle.

| Package | Locked version | Declared license | Lockfile scope |
| --- | --- | --- | --- |
| @asamuzakjp/css-color | 6.0.7 | MIT | development/optional |
| @asamuzakjp/dom-selector | 8.3.2 | MIT | development/optional |
| @babel/code-frame | 7.29.7 | MIT | development/optional |
| @babel/helper-validator-identifier | 7.29.7 | MIT | development/optional |
| @babel/runtime | 7.29.7 | MIT | development/optional |
| @bramus/specificity | 2.4.2 | MIT | development/optional |
| @csstools/color-helpers | 6.1.1 | MIT-0 | development/optional |
| @csstools/css-calc | 3.3.0 | MIT | development/optional |
| @csstools/css-color-parser | 4.2.2 | MIT | development/optional |
| @csstools/css-parser-algorithms | 4.0.0 | MIT | development/optional |
| @csstools/css-syntax-patches-for-csstree | 1.1.12 | MIT-0 | development/optional |
| @csstools/css-tokenizer | 4.0.0 | MIT | development/optional |
| @exodus/bytes | 1.15.1 | MIT | development/optional |
| @floating-ui/core | 1.8.0 | MIT | development/optional |
| @floating-ui/dom | 1.8.0 | MIT | development/optional |
| @floating-ui/react-dom | 2.1.9 | MIT | development/optional |
| @floating-ui/utils | 0.2.12 | MIT | development/optional |
| @get-bb/plugin-sdk | 0.4.34 | Undeclared (SDK upstream MIT) | development/optional |
| @hugeicons/core-free-icons | 4.3.0 | MIT | runtime/peer |
| @hugeicons/react | 1.1.10 | MIT | runtime/peer |
| @jridgewell/resolve-uri | 3.1.2 | MIT | development/optional |
| @jridgewell/sourcemap-codec | 1.6.0 | MIT | development/optional |
| @jridgewell/trace-mapping | 0.3.31 | MIT | development/optional |
| @oxc-project/types | 0.148.0 | MIT | development/optional |
| @pierre/diffs | 1.3.6 | apache-2.0 | development/optional |
| @pierre/theme | 2.0.0 | apache-2.0 | development/optional |
| @pierre/theming | 1.0.1 | apache-2.0 | development/optional |
| @radix-ui/number | 1.1.3 | MIT | development/optional |
| @radix-ui/primitive | 1.1.7 | MIT | runtime/peer |
| @radix-ui/react-alert-dialog | 1.1.23 | MIT | development/optional |
| @radix-ui/react-arrow | 1.1.15 | MIT | development/optional |
| @radix-ui/react-checkbox | 1.3.11 | MIT | runtime/peer |
| @radix-ui/react-collection | 1.1.15 | MIT | development/optional |
| @radix-ui/react-compose-refs | 1.1.5 | MIT | runtime/peer |
| @radix-ui/react-context | 1.2.2 | MIT | runtime/peer |
| @radix-ui/react-context-menu | 2.3.7 | MIT | development/optional |
| @radix-ui/react-dialog | 1.1.23 | MIT | development/optional |
| @radix-ui/react-direction | 1.1.4 | MIT | development/optional |
| @radix-ui/react-dismissable-layer | 1.1.19 | MIT | development/optional |
| @radix-ui/react-dropdown-menu | 2.1.24 | MIT | development/optional |
| @radix-ui/react-focus-guards | 1.1.6 | MIT | development/optional |
| @radix-ui/react-focus-scope | 1.1.16 | MIT | development/optional |
| @radix-ui/react-hover-card | 1.1.23 | MIT | development/optional |
| @radix-ui/react-id | 1.1.4 | MIT | development/optional |
| @radix-ui/react-menu | 2.1.24 | MIT | development/optional |
| @radix-ui/react-menubar | 1.1.24 | MIT | development/optional |
| @radix-ui/react-navigation-menu | 1.2.22 | MIT | development/optional |
| @radix-ui/react-popover | 1.1.23 | MIT | development/optional |
| @radix-ui/react-popper | 1.3.7 | MIT | development/optional |
| @radix-ui/react-portal | 1.1.17 | MIT | development/optional |
| @radix-ui/react-presence | 1.1.10 | MIT | runtime/peer |
| @radix-ui/react-primitive | 2.1.10 | MIT | runtime/peer |
| @radix-ui/react-roving-focus | 1.1.19 | MIT | development/optional |
| @radix-ui/react-select | 2.3.7 | MIT | development/optional |
| @radix-ui/react-slot | 1.3.3 | MIT | runtime/peer |
| @radix-ui/react-tooltip | 1.2.16 | MIT | development/optional |
| @radix-ui/react-use-callback-ref | 1.1.4 | MIT | development/optional |
| @radix-ui/react-use-controllable-state | 1.2.6 | MIT | runtime/peer |
| @radix-ui/react-use-effect-event | 0.0.5 | MIT | runtime/peer |
| @radix-ui/react-use-is-hydrated | 0.1.3 | MIT | development/optional |
| @radix-ui/react-use-layout-effect | 1.1.4 | MIT | runtime/peer |
| @radix-ui/react-use-previous | 1.1.4 | MIT | development/optional |
| @radix-ui/react-use-rect | 1.1.4 | MIT | development/optional |
| @radix-ui/react-use-size | 1.1.4 | MIT | runtime/peer |
| @radix-ui/react-visually-hidden | 1.2.11 | MIT | development/optional |
| @radix-ui/rect | 1.1.3 | MIT | development/optional |
| @rolldown/binding-android-arm-eabi | 1.2.7 | MIT | development/optional |
| @rolldown/binding-android-arm64 | 1.2.7 | MIT | development/optional |
| @rolldown/binding-darwin-arm64 | 1.2.7 | MIT | development/optional |
| @rolldown/binding-darwin-x64 | 1.2.7 | MIT | development/optional |
| @rolldown/binding-freebsd-x64 | 1.2.7 | MIT | development/optional |
| @rolldown/binding-linux-arm-gnueabihf | 1.2.7 | MIT | development/optional |
| @rolldown/binding-linux-arm64-gnu | 1.2.7 | MIT | development/optional |
| @rolldown/binding-linux-arm64-musl | 1.2.7 | MIT | development/optional |
| @rolldown/binding-linux-ppc64-gnu | 1.2.7 | MIT | development/optional |
| @rolldown/binding-linux-s390x-gnu | 1.2.7 | MIT | development/optional |
| @rolldown/binding-linux-x64-gnu | 1.2.7 | MIT | development/optional |
| @rolldown/binding-linux-x64-musl | 1.2.7 | MIT | development/optional |
| @rolldown/binding-openharmony-arm64 | 1.2.7 | MIT | development/optional |
| @rolldown/binding-win32-arm64-msvc | 1.2.7 | MIT | development/optional |
| @rolldown/binding-win32-x64-msvc | 1.2.7 | MIT | development/optional |
| @rolldown/pluginutils | 1.0.1 | MIT | development/optional |
| @shikijs/core | 4.4.3 | MIT | development/optional |
| @shikijs/engine-javascript | 4.4.3 | MIT | development/optional |
| @shikijs/engine-oniguruma | 4.4.3 | MIT | development/optional |
| @shikijs/langs | 4.4.3 | MIT | development/optional |
| @shikijs/primitive | 4.4.3 | MIT | development/optional |
| @shikijs/themes | 4.4.3 | MIT | development/optional |
| @shikijs/transformers | 4.4.3 | MIT | development/optional |
| @shikijs/types | 4.4.3 | MIT | development/optional |
| @shikijs/vscode-textmate | 10.0.2 | MIT | development/optional |
| @testing-library/dom | 10.4.1 | MIT | development/optional |
| @testing-library/react | 16.3.3 | MIT | development/optional |
| @types/aria-query | 5.0.4 | MIT | development/optional |
| @types/better-sqlite3 | 7.6.13 | MIT | development/optional |
| @types/chai | 5.2.3 | MIT | development/optional |
| @types/deep-eql | 4.0.2 | MIT | development/optional |
| @types/estree | 1.0.9 | MIT | development/optional |
| @types/hast | 3.0.5 | MIT | development/optional |
| @types/mdast | 4.0.4 | MIT | development/optional |
| @types/node | 22.20.1 | MIT | development/optional |
| @types/react | 19.2.18 | MIT | runtime/peer |
| @types/react-dom | 19.2.7 | MIT | runtime/peer |
| @types/unist | 3.0.3 | MIT | development/optional |
| @ungap/structured-clone | 1.4.0 | ISC | development/optional |
| @vitest/mocker | 5.0.0 | MIT | development/optional |
| @vitest/spy | 5.0.0 | MIT | development/optional |
| ansi-regex | 5.0.1 | MIT | development/optional |
| ansi-styles | 5.2.0 | MIT | development/optional |
| aria-hidden | 1.2.6 | MIT | development/optional |
| aria-query | 5.3.0 | Apache-2.0 | development/optional |
| assertion-error | 2.0.1 | MIT | development/optional |
| base64-js | 1.5.1 | MIT | development/optional |
| better-sqlite3 | 12.11.1 | MIT | development/optional |
| bidi-js | 1.0.3 | MIT | development/optional |
| bindings | 1.5.0 | MIT | development/optional |
| bl | 4.1.0 | MIT | development/optional |
| buffer | 5.7.1 | MIT | development/optional |
| ccount | 2.0.1 | MIT | development/optional |
| chai | 6.2.2 | MIT | development/optional |
| character-entities-html4 | 2.1.0 | MIT | development/optional |
| character-entities-legacy | 3.0.0 | MIT | development/optional |
| chownr | 1.1.4 | ISC | development/optional |
| class-variance-authority | 0.7.1 | Apache-2.0 | development/optional |
| clsx | 2.1.1 | MIT | development/optional |
| comma-separated-tokens | 2.0.3 | MIT | development/optional |
| cron-parser | 5.10.0 | MIT | development/optional |
| css-tree | 3.2.1 | MIT | development/optional |
| csstype | 3.2.3 | MIT | runtime/peer |
| data-urls | 7.0.0 | MIT | development/optional |
| data-urls/node_modules/whatwg-url | 16.0.1 | MIT | development/optional |
| decimal.js | 10.6.0 | MIT | development/optional |
| decompress-response | 6.0.0 | MIT | development/optional |
| deep-extend | 0.6.0 | MIT | development/optional |
| dequal | 2.0.3 | MIT | development/optional |
| detect-libc | 2.1.2 | Apache-2.0 | development/optional |
| detect-node-es | 1.1.0 | MIT | development/optional |
| devlop | 1.1.0 | MIT | development/optional |
| diff | 9.0.0 | BSD-3-Clause | development/optional |
| dom-accessibility-api | 0.5.16 | MIT | development/optional |
| end-of-stream | 1.4.5 | MIT | development/optional |
| entities | 8.0.0 | BSD-2-Clause | development/optional |
| es-module-lexer | 2.3.2 | MIT | development/optional |
| estree-walker | 3.0.3 | MIT | development/optional |
| expand-template | 2.0.3 | (MIT OR WTFPL) | development/optional |
| expect-type | 1.4.0 | Apache-2.0 | development/optional |
| fdir | 6.5.0 | MIT | development/optional |
| file-uri-to-path | 1.0.0 | MIT | development/optional |
| fs-constants | 1.0.0 | MIT | development/optional |
| fsevents | 2.3.3 | MIT | development/optional |
| get-nonce | 1.0.1 | MIT | development/optional |
| github-from-package | 0.0.0 | MIT | development/optional |
| hast-util-to-html | 9.0.5 | MIT | development/optional |
| hast-util-whitespace | 3.0.0 | MIT | development/optional |
| hono | 4.13.5 | MIT | development/optional |
| html-encoding-sniffer | 6.0.0 | MIT | development/optional |
| html-void-elements | 3.0.0 | MIT | development/optional |
| ieee754 | 1.2.1 | BSD-3-Clause | development/optional |
| inherits | 2.0.4 | ISC | development/optional |
| ini | 1.3.8 | ISC | development/optional |
| is-potential-custom-element-name | 1.0.1 | MIT | development/optional |
| js-tokens | 4.0.0 | MIT | development/optional |
| jsdom | 30.0.1 | MIT | development/optional |
| lightningcss | 1.33.0 | MPL-2.0 | development/optional |
| lightningcss-android-arm64 | 1.33.0 | MPL-2.0 | development/optional |
| lightningcss-darwin-arm64 | 1.33.0 | MPL-2.0 | development/optional |
| lightningcss-darwin-x64 | 1.33.0 | MPL-2.0 | development/optional |
| lightningcss-freebsd-x64 | 1.33.0 | MPL-2.0 | development/optional |
| lightningcss-linux-arm-gnueabihf | 1.33.0 | MPL-2.0 | development/optional |
| lightningcss-linux-arm64-gnu | 1.33.0 | MPL-2.0 | development/optional |
| lightningcss-linux-arm64-musl | 1.33.0 | MPL-2.0 | development/optional |
| lightningcss-linux-x64-gnu | 1.33.0 | MPL-2.0 | development/optional |
| lightningcss-linux-x64-musl | 1.33.0 | MPL-2.0 | development/optional |
| lightningcss-win32-arm64-msvc | 1.33.0 | MPL-2.0 | development/optional |
| lightningcss-win32-x64-msvc | 1.33.0 | MPL-2.0 | development/optional |
| lru_map | 0.4.1 | MIT | development/optional |
| lru-cache | 11.5.2 | BlueOak-1.0.0 | development/optional |
| luxon | 3.7.2 | MIT | development/optional |
| lz-string | 1.5.0 | MIT | development/optional |
| magic-string | 1.2.3 | MIT | development/optional |
| mdast-util-to-hast | 13.2.1 | MIT | development/optional |
| mdn-data | 2.27.1 | CC0-1.0 | development/optional |
| micromark-util-character | 2.1.1 | MIT | development/optional |
| micromark-util-encode | 2.0.1 | MIT | development/optional |
| micromark-util-sanitize-uri | 2.0.1 | MIT | development/optional |
| micromark-util-symbol | 2.0.1 | MIT | development/optional |
| micromark-util-types | 2.0.2 | MIT | development/optional |
| mimic-response | 3.1.0 | MIT | development/optional |
| minimist | 1.2.8 | MIT | development/optional |
| mkdirp-classic | 0.5.3 | MIT | development/optional |
| nanoid | 3.3.18 | MIT | development/optional |
| napi-build-utils | 2.0.0 | MIT | development/optional |
| node-abi | 3.96.0 | MIT | development/optional |
| obug | 2.1.4 | MIT | development/optional |
| once | 1.4.0 | ISC | development/optional |
| oniguruma-parser | 0.12.2 | MIT | development/optional |
| oniguruma-to-es | 4.3.6 | MIT | development/optional |
| parse5 | 8.0.1 | MIT | development/optional |
| picocolors | 1.1.1 | ISC | development/optional |
| picomatch | 4.0.7 | MIT | development/optional |
| postcss | 8.5.28 | MIT | development/optional |
| prebuild-install | 7.1.3 | MIT | development/optional |
| pretty-format | 27.5.1 | MIT | development/optional |
| property-information | 7.2.0 | MIT | development/optional |
| pump | 3.0.4 | MIT | development/optional |
| punycode | 2.3.1 | MIT | development/optional |
| rc | 1.2.8 | (BSD-2-Clause OR MIT OR Apache-2.0) | development/optional |
| react | 19.2.8 | MIT | runtime/peer |
| react-dom | 19.2.8 | MIT | runtime/peer |
| react-is | 17.0.2 | MIT | development/optional |
| react-remove-scroll | 2.7.2 | MIT | development/optional |
| react-remove-scroll-bar | 2.3.8 | MIT | development/optional |
| react-style-singleton | 2.2.3 | MIT | development/optional |
| readable-stream | 3.6.2 | MIT | development/optional |
| regex | 6.1.0 | MIT | development/optional |
| regex-recursion | 6.0.2 | MIT | development/optional |
| regex-utilities | 2.3.0 | MIT | development/optional |
| require-from-string | 2.0.2 | MIT | development/optional |
| rolldown | 1.2.7 | MIT | development/optional |
| safe-buffer | 5.2.1 | MIT | development/optional |
| saxes | 6.0.0 | ISC | development/optional |
| scheduler | 0.27.0 | MIT | runtime/peer |
| semver | 7.8.5 | ISC | development/optional |
| shiki | 4.4.3 | MIT | development/optional |
| siginfo | 2.0.0 | ISC | development/optional |
| simple-concat | 1.0.1 | MIT | development/optional |
| simple-get | 4.0.1 | MIT | development/optional |
| sonner | 1.7.4 | MIT | development/optional |
| source-map-js | 1.2.1 | BSD-3-Clause | development/optional |
| space-separated-tokens | 2.0.2 | MIT | development/optional |
| stackback | 0.0.2 | MIT | development/optional |
| std-env | 4.2.0 | MIT | development/optional |
| string_decoder | 1.3.0 | MIT | development/optional |
| stringify-entities | 4.0.4 | MIT | development/optional |
| strip-json-comments | 2.0.1 | MIT | development/optional |
| symbol-tree | 3.2.4 | MIT | development/optional |
| tailwind-merge | 3.6.0 | MIT | development/optional |
| tar-fs | 2.1.5 | MIT | development/optional |
| tar-stream | 2.2.0 | MIT | development/optional |
| tinybench | 6.1.4 | MIT | development/optional |
| tinyexec | 1.3.0 | MIT | development/optional |
| tinyglobby | 0.2.17 | MIT | development/optional |
| tldts | 7.4.11 | MIT | development/optional |
| tldts-core | 7.4.11 | MIT | development/optional |
| tough-cookie | 6.0.2 | BSD-3-Clause | development/optional |
| tr46 | 6.0.0 | MIT | development/optional |
| trim-lines | 3.0.1 | MIT | development/optional |
| tslib | 2.8.1 | 0BSD | development/optional |
| tunnel-agent | 0.6.0 | Apache-2.0 | development/optional |
| typescript | 5.9.3 | Apache-2.0 | development/optional |
| undici | 8.10.1 | MIT | development/optional |
| undici-types | 6.21.0 | MIT | development/optional |
| unist-util-is | 6.0.1 | MIT | development/optional |
| unist-util-position | 5.0.0 | MIT | development/optional |
| unist-util-stringify-position | 4.0.0 | MIT | development/optional |
| unist-util-visit | 5.1.0 | MIT | development/optional |
| unist-util-visit-parents | 6.0.2 | MIT | development/optional |
| use-callback-ref | 1.3.3 | MIT | development/optional |
| use-sidecar | 1.1.3 | MIT | development/optional |
| util-deprecate | 1.0.2 | MIT | development/optional |
| vaul | 1.1.2 | MIT | development/optional |
| vfile | 6.0.3 | MIT | development/optional |
| vfile-message | 4.0.3 | MIT | development/optional |
| vite | 8.2.2 | MIT | development/optional |
| vitest | 5.0.0 | MIT | development/optional |
| w3c-xmlserializer | 5.0.0 | MIT | development/optional |
| webidl-conversions | 8.0.1 | BSD-2-Clause | development/optional |
| whatwg-mimetype | 5.0.0 | MIT | development/optional |
| whatwg-url | 17.1.0 | MIT | development/optional |
| why-is-node-running | 2.3.0 | MIT | development/optional |
| wrappy | 1.0.2 | ISC | development/optional |
| xml-name-validator | 5.0.0 | Apache-2.0 | development/optional |
| xmlchars | 2.2.0 | MIT | development/optional |
| zod | 4.5.4 | MIT | runtime/peer |
| zwitch | 2.0.4 | MIT | development/optional |
