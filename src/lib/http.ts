export function jsonError(message: string, status = 400, details?: unknown) {
  return Response.json({ error: message, details }, { status });
}

export function asErrorMessage(error: unknown) {
  if (error instanceof Error && /connection pool|P2024/.test(error.message)) {
    return "서버 연결이 혼잡하여 요청이 지연됐습니다. 잠시 후 다시 확인해 주세요.";
  }
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error";
}
