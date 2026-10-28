import "server-only";
import { NextResponse } from "next/server";
import { StorageError } from "./storage";

export function errorResponse(err: unknown) {
  if (err instanceof StorageError) return NextResponse.json({ error: err.message }, { status: err.status });
  if (err instanceof SyntaxError) return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  console.error(err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
