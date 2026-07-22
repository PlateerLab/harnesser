"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui";

export default function AdminIndex() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/problems");
  }, [router]);
  return <Spinner />;
}
