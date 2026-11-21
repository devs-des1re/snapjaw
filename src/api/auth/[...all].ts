import { auth } from "../../auth";
import { withRequest } from "../../../server/http/request";

export function GET(request: Request) {
  return withRequest(request, () => auth.handlers.GET(request));
}

export function POST(request: Request) {
  return withRequest(request, () => auth.handlers.POST(request));
}
