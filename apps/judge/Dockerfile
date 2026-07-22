FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        python3-redis \
        python3-requests \
        g++ \
        openjdk-21-jdk-headless \
        golang-go \
        tini \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 제출 코드를 실행할 비특권 사용자
RUN useradd --system --no-create-home --shell /usr/sbin/nologin sandbox \
    && mkdir -p /work /opt/gocache \
    && chmod 777 /work /opt/gocache

# Go 표준 라이브러리 빌드 캐시를 미리 데워 첫 채점 지연 제거
RUN mkdir -p /tmp/warm && printf 'package main\n\nimport "fmt"\n\nfunc main() { fmt.Println("ok") }\n' > /tmp/warm/main.go \
    && cd /tmp/warm && GOCACHE=/opt/gocache HOME=/tmp go build -o /tmp/warm/main main.go \
    && rm -rf /tmp/warm && chmod -R 777 /opt/gocache

ENV GOCACHE=/opt/gocache

WORKDIR /app
COPY worker.py languages.py sandbox.py ./

ENTRYPOINT ["tini", "--"]
CMD ["python3", "worker.py"]
