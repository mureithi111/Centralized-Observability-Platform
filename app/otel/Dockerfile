FROM public.ecr.aws/aws-observability/aws-otel-collector:v0.51.0

COPY collector-config.yaml /etc/otel-config.yaml

CMD ["--config=/etc/otel-config.yaml"]
