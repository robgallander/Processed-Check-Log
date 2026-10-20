// Reads the signed-in user that Azure Static Web Apps passes to the API.
function principal(request) {
  const header = request.headers.get("x-ms-client-principal");
  if (!header) return null;
  try {
    return JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

const EDITOR = "checklog_editor";
const VIEWER = "checklog_viewer";

function roles(request) {
  const p = principal(request);
  return (p && p.userRoles) || [];
}
const canView = (request) => roles(request).some((r) => r === EDITOR || r === VIEWER);
const canEdit = (request) => roles(request).includes(EDITOR);
const who = (request) => {
  const p = principal(request);
  return (p && p.userDetails) || "";
};

const json = (status, body) => ({ status, jsonBody: body, headers: { "Cache-Control": "no-store" } });
const denied = () => json(403, { code: "permission_denied", error: "You don't have access to this." });

module.exports = { canView, canEdit, who, json, denied };
