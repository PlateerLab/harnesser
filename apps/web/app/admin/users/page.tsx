"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Role, User } from "@/lib/types";
import { fmtDateTime } from "@/lib/format";
import { useUser } from "@/components/useUser";
import { Shell } from "@/components/Shell";
import { Badge, Button, Card, Field, inputCls, Modal, Spinner } from "@/components/ui";

export default function UsersPage() {
  const { user, loading } = useUser(["admin"]);
  const [rows, setRows] = useState<User[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "candidate" as Role });

  const load = () => api.get<User[]>("/admin/users").then(setRows);

  useEffect(() => {
    if (user) load();
  }, [user]);

  const create = async () => {
    try {
      await api.post("/admin/users", form);
      setShowCreate(false);
      setForm({ email: "", name: "", password: "", role: "candidate" });
      load();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "생성 실패");
    }
  };

  const remove = async (target: User) => {
    if (!confirm(`${target.email} 계정을 삭제할까요? 응시 기록도 함께 삭제됩니다.`)) return;
    await api.del(`/admin/users/${target.id}`);
    load();
  };

  if (loading || !user) return <Spinner />;

  return (
    <Shell user={user}>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">사용자 관리</h1>
        <Button onClick={() => setShowCreate(true)}>+ 사용자 추가</Button>
      </div>
      {!rows ? (
        <Spinner />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
                <th className="px-4 py-3">이름</th>
                <th className="px-4 py-3">이메일</th>
                <th className="px-4 py-3">역할</th>
                <th className="px-4 py-3">생성일</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3 text-slate-500">{u.email}</td>
                  <td className="px-4 py-3">
                    <Badge value={u.role} />
                  </td>
                  <td className="px-4 py-3 text-slate-500">{fmtDateTime(u.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    {u.id !== user.id && (
                      <button className="text-xs text-red-500 hover:underline" onClick={() => remove(u)}>
                        삭제
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {showCreate && (
        <Modal title="사용자 추가" onClose={() => setShowCreate(false)}>
          <div className="space-y-3">
            <Field label="이름">
              <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="이메일">
              <input
                className={inputCls}
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="비밀번호" hint="6자 이상">
              <input
                className={inputCls}
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
            <Field label="역할">
              <select
                className={inputCls}
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              >
                <option value="candidate">응시자</option>
                <option value="evaluator">평가자</option>
                <option value="admin">관리자</option>
              </select>
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setShowCreate(false)}>
                취소
              </Button>
              <Button onClick={create}>생성</Button>
            </div>
          </div>
        </Modal>
      )}
    </Shell>
  );
}
