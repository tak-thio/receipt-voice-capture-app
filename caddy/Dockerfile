# Custom Caddy with the Coraza WAF module (embeds OWASP Core Rule Set via
# coraza-coreruleset). Build: docker compose builds this for the caddy service.
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/corazawaf/coraza-caddy/v2

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
