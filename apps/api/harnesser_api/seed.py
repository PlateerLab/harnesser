"""최초 기동 시 데모 계정/문제/시험 시드 (SEED_DEMO_DATA=true, 사용자 0명일 때 1회)."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Assessment, AssessmentProblem, Assignment, Problem, TestCase, User
from .security import hash_password

STARTER = {
    "sum": {
        "python": "import sys\n\na, b = map(int, sys.stdin.read().split())\nprint(a + b)\n",
        "cpp": "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    long long a, b;\n    cin >> a >> b;\n    cout << a + b << \"\\n\";\n    return 0;\n}\n",
        "java": "import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        long a = sc.nextLong(), b = sc.nextLong();\n        System.out.println(a + b);\n    }\n}\n",
        "go": "package main\n\nimport \"fmt\"\n\nfunc main() {\n    var a, b int64\n    fmt.Scan(&a, &b)\n    fmt.Println(a + b)\n}\n",
    },
    "empty": {
        "python": "import sys\n\ndata = sys.stdin.read().split()\n# 여기에 풀이를 작성하세요\n",
        "cpp": "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    // 여기에 풀이를 작성하세요\n    return 0;\n}\n",
        "java": "import java.util.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner sc = new Scanner(System.in);\n        // 여기에 풀이를 작성하세요\n    }\n}\n",
        "go": "package main\n\nimport (\n    \"bufio\"\n    \"fmt\"\n    \"os\"\n)\n\nfunc main() {\n    reader := bufio.NewReader(os.Stdin)\n    _ = reader\n    _ = fmt.Sprint\n    // 여기에 풀이를 작성하세요\n}\n",
    },
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
        time_limit_ms=2000,
        memory_limit_mb=256,
        starter_code=STARTER["sum"],
        created_by=admin.id,
        statement_md=(
            "## 문제\n\n두 정수 A와 B가 주어질 때, A+B를 출력하는 프로그램을 작성하세요.\n\n"
            "## 입력\n\n첫째 줄에 A와 B가 공백으로 구분되어 주어집니다.\n"
            "(-10^12 ≤ A, B ≤ 10^12)\n\n"
            "## 출력\n\nA+B를 출력합니다.\n"
        ),
    )
    p1.test_cases = [
        TestCase(ordinal=0, input="1 2\n", expected_output="3\n", is_sample=True),
        TestCase(ordinal=1, input="-3 10\n", expected_output="7\n", is_sample=True),
        TestCase(ordinal=2, input="1000000000000 1000000000000\n", expected_output="2000000000000\n"),
        TestCase(ordinal=3, input="0 0\n", expected_output="0\n"),
        TestCase(ordinal=4, input="-1000000000000 999999999999\n", expected_output="-1\n"),
    ]

    p2 = Problem(
        title="올바른 괄호",
        difficulty="easy",
        time_limit_ms=2000,
        memory_limit_mb=256,
        starter_code=STARTER["empty"],
        created_by=admin.id,
        statement_md=(
            "## 문제\n\n`(`, `)`, `{`, `}`, `[`, `]` 로 이루어진 문자열이 주어집니다.\n"
            "괄호의 짝이 모두 올바르게 맞으면 `true`, 아니면 `false`를 출력하세요.\n\n"
            "## 입력\n\n첫째 줄에 괄호 문자열이 주어집니다. (길이 1 ≤ N ≤ 100,000)\n\n"
            "## 출력\n\n`true` 또는 `false`를 출력합니다.\n"
        ),
    )
    p2.test_cases = [
        TestCase(ordinal=0, input="()[]{}\n", expected_output="true\n", is_sample=True),
        TestCase(ordinal=1, input="([)]\n", expected_output="false\n", is_sample=True),
        TestCase(ordinal=2, input="((((()))))\n", expected_output="true\n"),
        TestCase(ordinal=3, input="(\n", expected_output="false\n"),
        TestCase(ordinal=4, input="{[()()]}[]\n", expected_output="true\n"),
        TestCase(ordinal=5, input=")(\n", expected_output="false\n"),
    ]

    p3 = Problem(
        title="가장 긴 증가하는 부분 수열",
        difficulty="medium",
        time_limit_ms=2000,
        memory_limit_mb=256,
        starter_code=STARTER["empty"],
        created_by=admin.id,
        statement_md=(
            "## 문제\n\n수열 A가 주어질 때, 가장 긴 **순증가** 부분 수열의 길이를 구하세요.\n\n"
            "예를 들어 A = {10, 20, 10, 30, 20, 50} 이면 {10, 20, 30, 50}이 가장 길고, 답은 4입니다.\n\n"
            "## 입력\n\n첫째 줄에 수열의 크기 N (1 ≤ N ≤ 1,000),\n둘째 줄에 수열 A가 공백으로 구분되어 주어집니다. "
            "(1 ≤ A_i ≤ 1,000,000)\n\n## 출력\n\n가장 긴 증가하는 부분 수열의 길이를 출력합니다.\n"
        ),
    )
    p3.test_cases = [
        TestCase(ordinal=0, input="6\n10 20 10 30 20 50\n", expected_output="4\n", is_sample=True),
        TestCase(ordinal=1, input="1\n7\n", expected_output="1\n", is_sample=True),
        TestCase(ordinal=2, input="5\n5 4 3 2 1\n", expected_output="1\n"),
        TestCase(ordinal=3, input="8\n1 2 3 4 5 6 7 8\n", expected_output="8\n"),
        TestCase(ordinal=4, input="10\n3 1 4 1 5 9 2 6 5 3\n", expected_output="4\n", weight=2),
    ]

    db.add_all([p1, p2, p3])
    await db.flush()

    standard = Assessment(
        title="백엔드 개발자 코딩 테스트 (데모)",
        description="일반 코딩 테스트 데모입니다. 외부 도구 없이 문제를 해결하세요.",
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
        description="AI 어시스턴트와 협업하여 문제를 해결하는 시험입니다. 모든 대화가 기록되며 평가에 반영됩니다.",
        mode="ai_assisted",
        duration_min=90,
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
