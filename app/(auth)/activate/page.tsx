"use client";

import { Suspense } from "react";
import { CodeForm } from "@/components/CodeForm";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <CodeForm purpose="activate" />
    </Suspense>
  );
}
