# AWS Emulator has no published image; this follows the Dockerfile in its "Getting started with Docker"
# guide and picks the rpm for the build architecture (aarch64 on Apple silicon).
FROM public.ecr.aws/amazonlinux/amazonlinux:2023-minimal
# uname -m already prints the rpm suffix (x86_64 or aarch64), with or without BuildKit.
RUN arch="$(uname -m)" \
    && curl -fsSL -o /tmp/aws-emulator.rpm \
       "https://downloads.aws.com/aws-emulator/packages/aws-emulator/LTS/latest/aws-emulator-${arch}.rpm" \
    && rpm -i /tmp/aws-emulator.rpm && rm /tmp/aws-emulator.rpm \
    && mkdir -p /home/emulator/.aws/emulator && chown -R 1000 /home/emulator
USER 1000
ENV HOME=/home/emulator
EXPOSE 9297
HEALTHCHECK --interval=2s --timeout=3s --retries=30 \
  CMD curl -sf --cacert /home/emulator/.aws/emulator/9297/ca.pem https://127.0.0.1:9297/__admin/health
ENTRYPOINT ["aws-emulator", "-b", "0.0.0.0"]
