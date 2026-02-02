FROM trailbase/trailbase:latest

USER root
WORKDIR /app

RUN mkdir -p /app/traildepot/migrations

COPY config.textproto /app/traildepot/config.textproto
COPY init.sql /app/traildepot/migrations/V10__init.sql

RUN chown -R trailbase:trailbase /app/traildepot && \
    chmod -R 777 /app/traildepot

EXPOSE 4000

USER trailbase
CMD ["/app/trail", "--data-dir", "/app/traildepot", "run", "--address", "0.0.0.0:4000", "--dev"]
