import type { NextFunction, ParamsDictionary, Request, Response } from "express-serve-static-core";
import { roleHasPermission, type Permission } from "../../domain/permissions.js";
import { sendError } from "../errorEnvelope.js";

// V2-2 (LLD_v2 §3, ADR-9): must run after authMiddleware (req.user is
// required). Every protected route names exactly one permission; the
// PERMISSIONS table in domain/permissions.ts is the single source of truth
// for which roles satisfy it.
//
// The returned middleware is itself generic over Express's route-parameter
// type P (defaulted the same way express-serve-static-core's RequestHandler
// defaults it). That's not decoration — Express's router.get/post overloads
// infer ONE shared params type across an entire handler array from the
// route's literal path (e.g. "/:id" -> { id: string }); a middleware typed
// with a *concrete* Request<ParamsDictionary> here would fail that
// unification and silently fall back to the loosest overload for the whole
// call, turning every req.params.foo in the neighboring route handler into
// `string | undefined` under noUncheckedIndexedAccess. Staying generic lets
// each call site instantiate P to its own route's param type instead.
export function requirePermission(permission: Permission) {
  return function permissionMiddleware<P = ParamsDictionary>(
    req: Request<P>,
    res: Response,
    next: NextFunction
  ): void {
    const role = req.user?.role;
    if (!role || !roleHasPermission(role, permission)) {
      sendError(res, "FORBIDDEN", `Role "${role ?? "unknown"}" lacks permission "${permission}"`);
      return;
    }
    next();
  };
}
