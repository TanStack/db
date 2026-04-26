FROM trailbase/trailbase:0.26.6

COPY traildepot /app/traildepot/
EXPOSE 4000

CMD ["/app/trail", "--data-dir", "/app/traildepot", "run", "--address", "0.0.0.0:4000"]
