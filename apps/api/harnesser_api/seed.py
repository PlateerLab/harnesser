"""최초 기동 시 데모 계정/문제/시험 시드 (SEED_DEMO_DATA=true, 사용자 0명일 때 1회).

문제 지문은 '## 문제 / ## 입력 / ## 출력 / ## 제한 / ## 예시 설명' 구조를 표준으로 한다.
시작 코드는 4개 언어 모두 해당 문제의 입력을 읽는 뼈대까지 제공한다.
"""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Assessment, AssessmentProblem, Assignment, Problem, TestCase, User
from .security import hash_password


def _starter_sum() -> dict:
    return {
        "python": """import sys


def solve() -> None:
    a, b = map(int, sys.stdin.read().split())
    # TODO: A+B를 출력하세요
    print(...)


if __name__ == "__main__":
    solve()
""",
        "cpp": """#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    long long a, b;
    cin >> a >> b;
    // TODO: A+B를 출력하세요

    return 0;
}
""",
        "java": """import java.io.*;
import java.util.*;

// 클래스 이름은 반드시 Main이어야 합니다.
public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        StringTokenizer st = new StringTokenizer(br.readLine());
        long a = Long.parseLong(st.nextToken());
        long b = Long.parseLong(st.nextToken());
        // TODO: A+B를 출력하세요
    }
}
""",
        "go": """package main

import (
	"bufio"
	"fmt"
	"os"
)

var reader = bufio.NewReader(os.Stdin)
var writer = bufio.NewWriter(os.Stdout)

func main() {
	defer writer.Flush()

	var a, b int64
	fmt.Fscan(reader, &a, &b)
	// TODO: A+B를 출력하세요
	_ = a
	_ = b
}
""",
    }


def _starter_brackets() -> dict:
    return {
        "python": """import sys


def solve() -> None:
    s = sys.stdin.readline().strip()
    # TODO: 짝이 모두 맞으면 "true", 아니면 "false"를 출력하세요
    print(...)


if __name__ == "__main__":
    solve()
""",
        "cpp": """#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    string s;
    cin >> s;
    // TODO: 짝이 모두 맞으면 "true", 아니면 "false"를 출력하세요

    return 0;
}
""",
        "java": """import java.io.*;
import java.util.*;

// 클래스 이름은 반드시 Main이어야 합니다.
public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        String s = br.readLine().trim();
        // TODO: 짝이 모두 맞으면 "true", 아니면 "false"를 출력하세요
    }
}
""",
        "go": """package main

import (
	"bufio"
	"fmt"
	"os"
)

var reader = bufio.NewReader(os.Stdin)
var writer = bufio.NewWriter(os.Stdout)

func main() {
	defer writer.Flush()

	var s string
	fmt.Fscan(reader, &s)
	// TODO: 짝이 모두 맞으면 "true", 아니면 "false"를 출력하세요
	_ = s
}
""",
    }


def _starter_lis() -> dict:
    return {
        "python": """import sys


def solve() -> None:
    data = sys.stdin.read().split()
    n = int(data[0])
    a = list(map(int, data[1 : 1 + n]))
    # TODO: 가장 긴 증가하는 부분 수열의 길이를 출력하세요
    print(...)


if __name__ == "__main__":
    solve()
""",
        "cpp": """#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    int n;
    cin >> n;
    vector<int> a(n);
    for (auto &x : a) cin >> x;
    // TODO: 가장 긴 증가하는 부분 수열의 길이를 출력하세요

    return 0;
}
""",
        "java": """import java.io.*;
import java.util.*;

// 클래스 이름은 반드시 Main이어야 합니다.
public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        int n = Integer.parseInt(br.readLine().trim());
        int[] a = new int[n];
        StringTokenizer st = new StringTokenizer(br.readLine());
        for (int i = 0; i < n; i++) a[i] = Integer.parseInt(st.nextToken());
        // TODO: 가장 긴 증가하는 부분 수열의 길이를 출력하세요
    }
}
""",
        "go": """package main

import (
	"bufio"
	"fmt"
	"os"
)

var reader = bufio.NewReader(os.Stdin)
var writer = bufio.NewWriter(os.Stdout)

func main() {
	defer writer.Flush()

	var n int
	fmt.Fscan(reader, &n)
	a := make([]int, n)
	for i := range a {
		fmt.Fscan(reader, &a[i])
	}
	// TODO: 가장 긴 증가하는 부분 수열의 길이를 출력하세요
	_ = a
}
""",
    }


async def seed_if_empty(db: AsyncSession) -> None:
    count = (await db.execute(select(func.count(User.id)))).scalar()
    if count:
        return

    admin = User(email="admin@harnesser.dev", name="관리자", password_hash=hash_password("admin1234"), role="admin")
    evaluator = User(
        email="evaluator@harnesser.dev", name="평가자", password_hash=hash_password("eval1234"), role="evaluator"
    )
    candidate = User(
        email="candidate@harnesser.dev", name="응시자", password_hash=hash_password("cand1234"), role="candidate"
    )
    db.add_all([admin, evaluator, candidate])
    await db.flush()

    p1 = Problem(
        title="두 수의 합",
        difficulty="easy",
        time_limit_ms=1000,
        memory_limit_mb=256,
        starter_code=_starter_sum(),
        created_by=admin.id,
        statement_md="""## 문제

두 정수 A와 B가 주어질 때, A+B를 출력하는 프로그램을 작성하세요.

플랫폼 사용법을 익히기 위한 연습 문제입니다. **실행** 버튼은 예시 테스트만 확인하고,
**제출** 버튼은 비공개 테스트를 포함해 전체 채점합니다.

## 입력

첫째 줄에 두 정수 A와 B가 공백으로 구분되어 주어집니다.

## 출력

첫째 줄에 A+B를 출력합니다.

## 제한

- -10¹² ≤ A, B ≤ 10¹²
- 값의 범위가 32비트 정수를 벗어날 수 있으므로 64비트 정수를 사용하세요.

## 예시 설명

- 예시 1: 1 + 2 = 3
- 예시 2: -3 + 10 = 7
""",
    )
    p1.test_cases = [
        TestCase(ordinal=0, input="1 2\n", expected_output="3\n", is_sample=True, weight=1),
        TestCase(ordinal=1, input="-3 10\n", expected_output="7\n", is_sample=True, weight=1),
        TestCase(ordinal=2, input="0 0\n", expected_output="0\n", weight=2),
        TestCase(ordinal=3, input="1000000000000 1000000000000\n", expected_output="2000000000000\n", weight=3),
        TestCase(ordinal=4, input="-1000000000000 999999999999\n", expected_output="-1\n", weight=3),
    ]

    long_true = "()" * 5000
    deep_true = "(" * 500 + ")" * 500
    p2 = Problem(
        title="올바른 괄호",
        difficulty="easy",
        time_limit_ms=1000,
        memory_limit_mb=256,
        starter_code=_starter_brackets(),
        created_by=admin.id,
        statement_md="""## 문제

`(`, `)`, `{`, `}`, `[`, `]` 여섯 종류의 문자로만 이루어진 문자열이 주어집니다.

다음 조건을 모두 만족하면 **올바른 괄호 문자열**입니다.

1. 여는 괄호는 반드시 같은 종류의 닫는 괄호로 닫혀야 합니다.
2. 괄호는 여닫는 순서가 올바라야 합니다. 예를 들어 `([)]`는 순서가 어긋나므로 올바르지 않습니다.

주어진 문자열이 올바르면 `true`, 아니면 `false`를 출력하세요.

## 입력

첫째 줄에 괄호 문자열 S가 주어집니다.

## 출력

첫째 줄에 `true` 또는 `false`를 출력합니다.

## 제한

- 1 ≤ |S| ≤ 100,000

## 예시 설명

- 예시 1: `()[]{}` — 세 쌍이 각각 올바르게 닫혀 `true`
- 예시 2: `([)]` — `[`가 닫히기 전에 `(`의 짝인 `)`가 나와 `false`
""",
    )
    p2.test_cases = [
        TestCase(ordinal=0, input="()[]{}\n", expected_output="true\n", is_sample=True, weight=1),
        TestCase(ordinal=1, input="([)]\n", expected_output="false\n", is_sample=True, weight=1),
        TestCase(ordinal=2, input="{[()()]}[]\n", expected_output="true\n", weight=2),
        TestCase(ordinal=3, input="(\n", expected_output="false\n", weight=2),
        TestCase(ordinal=4, input=")(\n", expected_output="false\n", weight=2),
        TestCase(ordinal=5, input=long_true + "\n", expected_output="true\n", weight=3),
        TestCase(ordinal=6, input=deep_true + "]\n", expected_output="false\n", weight=3),
    ]

    lis_desc = " ".join(str(x) for x in range(1000, 0, -1))
    lis_asc = " ".join(str(x) for x in range(1, 1001))
    p3 = Problem(
        title="가장 긴 증가하는 부분 수열",
        difficulty="medium",
        time_limit_ms=2000,
        memory_limit_mb=256,
        starter_code=_starter_lis(),
        created_by=admin.id,
        statement_md="""## 문제

수열 A가 주어질 때, 가장 긴 **순증가 부분 수열**(strictly increasing subsequence)의 길이를 구하세요.

부분 수열은 원래 수열에서 일부 원소를 골라 순서를 유지한 채 나열한 것입니다.
예를 들어 A = {10, 20, 10, 30, 20, 50}이면 가장 긴 증가 부분 수열은 {10, 20, 30, 50}이고 길이는 4입니다.

## 입력

- 첫째 줄에 수열의 크기 N
- 둘째 줄에 수열 A의 원소 N개가 공백으로 구분되어 주어집니다.

## 출력

첫째 줄에 가장 긴 증가하는 부분 수열의 길이를 출력합니다.

## 제한

- 1 ≤ N ≤ 1,000
- 1 ≤ Aᵢ ≤ 1,000,000
- N 범위가 작으므로 O(N²) 동적 계획법으로도 통과할 수 있습니다.

## 예시 설명

- 예시 1: {10, 20, 30, 50} → 4
- 예시 2: 원소가 하나뿐이므로 1
""",
    )
    p3.test_cases = [
        TestCase(ordinal=0, input="6\n10 20 10 30 20 50\n", expected_output="4\n", is_sample=True, weight=1),
        TestCase(ordinal=1, input="1\n7\n", expected_output="1\n", is_sample=True, weight=1),
        TestCase(ordinal=2, input="5\n5 4 3 2 1\n", expected_output="1\n", weight=2),
        TestCase(ordinal=3, input="10\n3 1 4 1 5 9 2 6 5 3\n", expected_output="4\n", weight=2),
        TestCase(ordinal=4, input="8\n1 1 1 1 1 1 1 1\n", expected_output="1\n", weight=2),
        TestCase(ordinal=5, input=f"1000\n{lis_desc}\n", expected_output="1\n", weight=3),
        TestCase(ordinal=6, input=f"1000\n{lis_asc}\n", expected_output="1000\n", weight=3),
    ]

    db.add_all([p1, p2, p3])
    await db.flush()

    standard = Assessment(
        title="백엔드 개발자 코딩 테스트 (데모)",
        description="일반 코딩 테스트 데모입니다. 외부 도구 없이 문제를 해결하세요. 모든 행동이 기록됩니다.",
        mode="standard",
        duration_min=90,
        created_by=admin.id,
    )
    standard.problems = [
        AssessmentProblem(problem_id=p1.id, ordinal=0, points=100),
        AssessmentProblem(problem_id=p2.id, ordinal=1, points=100),
    ]
    standard.assignments = [Assignment(user_id=candidate.id)]

    ai_test = Assessment(
        title="AI 활용 개발 역량 테스트 (데모)",
        description="AI 어시스턴트와 협업하여 문제를 해결하는 시험입니다. 질문 횟수에 한도가 있으며, 모든 대화가 기록되어 평가에 반영됩니다.",
        mode="ai_assisted",
        duration_min=90,
        ai_max_turns=20,
        created_by=admin.id,
    )
    ai_test.problems = [
        AssessmentProblem(problem_id=p2.id, ordinal=0, points=100),
        AssessmentProblem(problem_id=p3.id, ordinal=1, points=150),
    ]
    ai_test.assignments = [Assignment(user_id=candidate.id)]

    db.add_all([standard, ai_test])
    await db.commit()
    print("[seed] demo data created: admin/evaluator/candidate @harnesser.dev")
