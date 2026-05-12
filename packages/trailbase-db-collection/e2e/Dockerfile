FROM trailbase/trailbase:0.27.3

COPY traildepot /app/traildepot/
EXPOSE 4000

CMD ["/app/trail", "--data-dir", "/app/traildepot", "run", "--address", "0.0.0.0:4000"]
