"""언어별 컴파일/실행 정의.

time_mult: 문제 시간제한에 곱하는 언어 보정 계수 (인터프리터/VM 기동 비용 보정).
use_as_limit: RLIMIT_AS 적용 여부 — JVM/Go 런타임은 큰 가상 주소 공간이 필요해 제외하고
각각 -Xmx / GOMEMLIMIT로 대신 제어한다.
"""

LANGUAGES = {
    "python": {
        "source": "main.py",
        "compile": None,
        "run": lambda mem_mb: ["python3", "main.py"],
        "time_mult": 3.0,
        "use_as_limit": True,
        "env": {},
    },
    "cpp": {
        "source": "main.cpp",
        "compile": lambda: ["g++", "-O2", "-std=c++17", "-o", "main", "main.cpp"],
        "run": lambda mem_mb: ["./main"],
        "time_mult": 1.0,
        "use_as_limit": True,
        "env": {},
    },
    "java": {
        "source": "Main.java",
        "compile": lambda: ["javac", "-encoding", "UTF-8", "Main.java"],
        "run": lambda mem_mb: [
            "java",
            f"-Xmx{mem_mb}m",
            "-Xss64m",
            "-XX:+UseSerialGC",
            "-Dfile.encoding=UTF-8",
            "Main",
        ],
        "time_mult": 3.0,
        "use_as_limit": False,
        "env": {},
    },
    "go": {
        "source": "main.go",
        "compile": lambda: ["go", "build", "-o", "main", "main.go"],
        "run": lambda mem_mb: ["./main"],
        "time_mult": 2.0,
        "use_as_limit": False,
        "env": {"GOCACHE": "/opt/gocache", "HOME": "/tmp", "GOFLAGS": "-mod=mod"},
        "run_env": lambda mem_mb: {"GOMEMLIMIT": f"{mem_mb}MiB"},
    },
}
