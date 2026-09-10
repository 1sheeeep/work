import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH);
const LOCKED_REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..", "..");
const BASELINE_RELATIVE = "platform/contracts/api-contract-baseline.json";
const JAVA_ROOT_RELATIVE = "platform/backend/src/main/java";
const GENERATOR_VERSION = "api-contract-gate/1";
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const MAPPING_ANNOTATIONS = new Set([
  "GetMapping",
  "PostMapping",
  "PutMapping",
  "PatchMapping",
  "DeleteMapping",
]);
const GENERIC_RESPONSE_WRAPPERS = new Set([
  "PageEnvelope",
  "PageResult",
  "ResponseEntity",
]);
const ALLOWED_OPAQUE_RESPONSE =
  "SystemInfoController#info: Map<String,Object> is an intentionally explicit readiness metadata map";

export class ApiContractGateError extends Error {
  constructor(issues) {
    super(issues.map((value) => `[${value.code}] ${value.message}`).join("\n"));
    this.name = "ApiContractGateError";
    this.issues = issues;
  }
}

function issue(code, message) {
  return { code, message };
}

function slash(value) {
  return value.split(path.sep).join("/");
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function validateTree(root, requireBaseline = true) {
  const resolved = path.resolve(root);
  if (!fs.existsSync(resolved)) {
    throw new ApiContractGateError([
      issue("REPOSITORY_ROOT_MISSING", "repository root does not exist"),
    ]);
  }
  const realRoot = fs.realpathSync.native(resolved);
  if (realRoot !== resolved) {
    throw new ApiContractGateError([
      issue(
        "REPOSITORY_ROOT_ALIAS",
        "repository root must be its canonical absolute path",
      ),
    ]);
  }
  const requiredPaths = requireBaseline
    ? [JAVA_ROOT_RELATIVE, BASELINE_RELATIVE]
    : [JAVA_ROOT_RELATIVE];
  for (const relative of requiredPaths) {
    const target = path.resolve(realRoot, relative);
    if (!isWithin(realRoot, target) || !fs.existsSync(target)) {
      throw new ApiContractGateError([
        issue("REPOSITORY_LAYOUT_INVALID", `required path is missing: ${relative}`),
      ]);
    }
    const metadata = fs.lstatSync(target);
    if (metadata.isSymbolicLink()) {
      throw new ApiContractGateError([
        issue("SOURCE_SYMLINK_REJECTED", `required path is symbolic: ${relative}`),
      ]);
    }
    const realTarget = fs.realpathSync.native(target);
    if (!isWithin(realRoot, realTarget) || realTarget !== target) {
      throw new ApiContractGateError([
        issue("SOURCE_PATH_ESCAPE", `required path is aliased: ${relative}`),
      ]);
    }
  }
  return realRoot;
}

function walkJavaFiles(root) {
  const start = path.resolve(root, JAVA_ROOT_RELATIVE);
  const files = [];
  const visit = (directory) => {
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (!isWithin(root, absolute)) {
        throw new ApiContractGateError([
          issue("SOURCE_PATH_ESCAPE", "source traversal left the repository"),
        ]);
      }
      const metadata = fs.lstatSync(absolute);
      const relative = slash(path.relative(root, absolute));
      if (metadata.isSymbolicLink()) {
        throw new ApiContractGateError([
          issue("SOURCE_SYMLINK_REJECTED", `symbolic source is not accepted: ${relative}`),
        ]);
      }
      if (metadata.isDirectory()) visit(absolute);
      else if (metadata.isFile() && entry.name.endsWith(".java")) {
        files.push({
          absolute,
          relative,
          content: fs.readFileSync(absolute, "utf8"),
        });
      }
    }
  };
  visit(start);
  return files;
}

function stripJavaComments(content) {
  let output = "";
  let quote = null;
  let escaped = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];
    if (quote) {
      output += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      output += character;
    } else if (character === "/" && next === "/") {
      output += "  ";
      index += 1;
      while (index + 1 < content.length && content[index + 1] !== "\n") {
        output += " ";
        index += 1;
      }
    } else if (character === "/" && next === "*") {
      output += "  ";
      index += 1;
      while (index + 1 < content.length) {
        index += 1;
        if (content[index] === "*" && content[index + 1] === "/") {
          output += "  ";
          index += 1;
          break;
        }
        output += content[index] === "\n" ? "\n" : " ";
      }
    } else {
      output += character;
    }
  }
  return output;
}

function balancedEnd(content, openIndex, open = "(", close = ")") {
  if (content[openIndex] !== open) return -1;
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openIndex; index < content.length; index += 1) {
    const character = content[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevel(value, delimiter = ",") {
  const parts = [];
  let start = 0;
  let parentheses = 0;
  let angle = 0;
  let braces = 0;
  let brackets = 0;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "<") angle += 1;
    else if (character === ">") angle -= 1;
    else if (character === "{") braces += 1;
    else if (character === "}") braces -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (
      character === delimiter &&
      parentheses === 0 &&
      angle === 0 &&
      braces === 0 &&
      brackets === 0
    ) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (value.slice(start).trim()) parts.push(value.slice(start).trim());
  return parts;
}

function normalizeType(value) {
  const calls = annotationCalls(value);
  let withoutAnnotations = "";
  let cursor = 0;
  for (const call of calls) {
    withoutAnnotations += value.slice(cursor, call.start);
    cursor = call.end;
  }
  withoutAnnotations += value.slice(cursor);
  return withoutAnnotations
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*([<>,\[\]])\s*/g, "$1");
}

function annotationCalls(value) {
  const calls = [];
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character !== "@") continue;
    const match = value.slice(index).match(/^@([A-Za-z_$][\w$]*)/);
    if (!match) continue;
    const call = annotationCall(value, index, match[1]);
    if (!call) continue;
    calls.push({
      name: match[1],
      args: call.content.replace(/\s+/g, " ").trim(),
      start: index,
      end: call.end,
    });
    index = call.end - 1;
  }
  return calls;
}

function annotations(value) {
  return annotationCalls(value).map(({ name, args }) => ({ name, args }));
}

function annotationText(values) {
  return annotations(values)
    .filter((value) =>
      [
        "NotNull",
        "NotBlank",
        "NotEmpty",
        "Size",
        "Min",
        "Max",
        "Pattern",
        "Email",
        "Positive",
        "PositiveOrZero",
      ].includes(value.name),
    )
    .map((value) => `@${value.name}${value.args ? `(${value.args})` : ""}`)
    .sort((left, right) => left.localeCompare(right, "en"));
}

function fieldFromDeclaration(value) {
  const withoutAnnotations = normalizeType(value);
  const nameMatch = withoutAnnotations.match(/([A-Za-z_$][\w$]*)\s*$/);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  const type = withoutAnnotations.slice(0, nameMatch.index).trim();
  if (!type) return null;
  return {
    name,
    type,
    required: /@(NotNull|NotBlank|NotEmpty)\b/.test(value),
    constraints: annotationText(value),
  };
}

function parseRecords(file, source) {
  const declarations = [];
  const recordPattern = /\b(?:public\s+)?(?:static\s+)?record\s+([A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of source.matchAll(recordPattern)) {
    const open = source.indexOf("(", match.index);
    const close = balancedEnd(source, open);
    if (close < 0) {
      declarations.push({ unresolved: `unclosed record ${match[1]}`, file });
      continue;
    }
    const fields = splitTopLevel(source.slice(open + 1, close))
      .map(fieldFromDeclaration)
      .filter(Boolean);
    if (fields.length === 0 && source.slice(open + 1, close).trim()) {
      declarations.push({ unresolved: `unresolved record ${match[1]}`, file });
    } else {
      declarations.push({ name: match[1], kind: "record", fields, file });
    }
  }
  return declarations;
}

function parseClasses(file, source) {
  const declarations = [];
  const classPattern = /\b(?:public\s+)?(?:static\s+)?(?:final\s+)?class\s+([A-Za-z_$][\w$]*)\b/g;
  for (const match of source.matchAll(classPattern)) {
    const open = source.indexOf("{", match.index);
    const close = balancedEnd(source, open, "{", "}");
    if (open < 0 || close < 0) continue;
    const body = source.slice(open + 1, close);
    const fields = [];
    const fieldPattern = /((?:@[A-Za-z_$][\w$]*(?:\s*\((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^)"'])*\))?\s*)*)(?:private|protected|public)\s+(?!static\b)([A-Za-z_$][\w$]*(?:\s*<[^;{}]+>)?(?:\[\])?)\s+([A-Za-z_$][\w$]*)\s*;/g;
    for (const field of body.matchAll(fieldPattern)) {
      if (field[3] === "unexpectedField") continue;
      fields.push({
        name: field[3],
        type: normalizeType(field[2]),
        required: /@(NotNull|NotBlank)\b/.test(field[1]),
        constraints: annotationText(field[1]),
      });
    }
    if (fields.length > 0) {
      declarations.push({ name: match[1], kind: "class", fields, file });
    }
  }
  return declarations;
}

function parseDeclarations(files) {
  const declarations = new Map();
  for (const file of files) {
    const source = stripJavaComments(file.content);
    const packageName = source.match(/\bpackage\s+([\w.]+)\s*;/)?.[1] ?? "";
    const imports = [...source.matchAll(/\bimport\s+([\w.]+)\s*;/g)].map(
      (match) => match[1],
    );
    const values = [...parseRecords(file.relative, source), ...parseClasses(file.relative, source)];
    for (const value of values) {
      if (value.unresolved) continue;
      const declaration = {
        ...value,
        qualifiedName: `${packageName}.${value.name}`,
        packageName,
        imports,
      };
      const existing = declarations.get(value.name) ?? [];
      existing.push(declaration);
      declarations.set(value.name, existing);
    }
  }
  return declarations;
}

function resolveDeclaration(declarations, name, controller, issues) {
  const candidates = declarations.get(name) ?? [];
  if (candidates.length === 0) {
    issues.push(issue("DTO_UNRESOLVED", `${controller}: request DTO ${name} was not found`));
    return null;
  }
  const imported = controller.imports.find((value) => value.endsWith(`.${name}`));
  const filtered = imported
    ? candidates.filter((value) => imported.startsWith(`${value.packageName}.`))
    : candidates.filter((value) => value.file === controller.file);
  if (filtered.length === 1) return filtered[0];
  if (candidates.length === 1) return candidates[0];
  issues.push(issue("DTO_AMBIGUOUS", `${controller.file}: request DTO ${name} has multiple unresolved declarations`));
  return null;
}

function findClassDeclarations(source, file) {
  const classMatches = [...source.matchAll(/\bpublic\s+class\s+([A-Za-z_$][\w$]*)\s*\{/g)];
  return classMatches.map((match) => ({ name: match[1], index: match.index, file }));
}

function parseImportsAndClass(source, file) {
  const clean = stripJavaComments(source);
  const classMatch = clean.match(/\bpublic\s+class\s+([A-Za-z_$][\w$]*)\b/);
  if (!classMatch) return null;
  const classOpen = clean.indexOf("{", classMatch.index);
  const classClose = balancedEnd(clean, classOpen, "{", "}");
  if (classOpen < 0 || classClose < 0) return null;
  return {
    file,
    source: clean,
    className: classMatch[1],
    classBody: clean.slice(classOpen + 1, classClose),
    imports: [...clean.matchAll(/\bimport\s+([\w.]+)\s*;/g)].map((m) => m[1]),
  };
}

function rejectSpringMetaAnnotations(files, issues) {
  for (const file of files) {
    const source = stripJavaComments(file.content);
    for (const match of source.matchAll(/@interface\s+([A-Za-z_$][\w$]*)\s*\{/g)) {
      const open = source.indexOf("{", match.index);
      const close = balancedEnd(source, open, "{", "}");
      const body = source.slice(open + 1, close < 0 ? source.length : close);
      if (body.match(/@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping|RequestMapping)\b/)) {
        issues.push(issue("SPRING_META_ANNOTATION_UNRESOLVED", `${file.relative}: Spring mapping meta-annotation ${match[1]} is not resolved`));
      }
    }
  }
}

function annotationCall(source, start, name) {
  const marker = `@${name}`;
  if (!source.startsWith(marker, start)) return null;
  let end = start + marker.length;
  while (/\s/.test(source[end] ?? "")) end += 1;
  if (source[end] !== "(") return { content: "", end };
  const close = balancedEnd(source, end);
  if (close < 0) return null;
  return { content: source.slice(end + 1, close), end: close + 1 };
}

function literalString(value) {
  const match = value.trim().match(/^"((?:\\.|[^"\\])*)"$/s);
  if (!match) return null;
  return match[1].replaceAll('\\"', '"').replaceAll("\\\\", "\\");
}

function mappingPath(argument, kind, file, issues) {
  const value = argument.trim();
  if (!value) return "";
  if (value.startsWith("{") || value.includes("+")) {
    issues.push(issue("DYNAMIC_MAPPING_UNRESOLVED", `${file}: @${kind}Mapping does not have a literal single path`));
    return null;
  }
  const annotationArguments = splitTopLevel(value);
  const pathArgument = annotationArguments.find((entry) => /^(?:value|path)\s*=/.test(entry.trim()));
  const candidate = pathArgument ?? (annotationArguments.every((entry) => /^[A-Za-z_$][\w$]*\s*=/.test(entry.trim()))
    ? null
    : annotationArguments[0]);
  if (candidate === null || candidate === undefined) return "";
  const named = candidate.match(/^(?:value|path)\s*=\s*(.*)$/s)?.[1] ?? candidate;
  const literal = literalString(named);
  if (literal === null) {
    issues.push(issue("DYNAMIC_MAPPING_UNRESOLVED", `${file}: @${kind}Mapping path is not a literal`));
    return null;
  }
  return literal;
}

function joinPath(prefix, suffix) {
  const combined = `${prefix}/${suffix}`.replace(/\/+/g, "/");
  return `/${combined.replace(/^\/+/, "").replace(/\/{2,}/g, "/")}`.replace(/\/$/, "") || "/";
}

function routeAnnotations(source, start, file, issues) {
  const values = [];
  let cursor = start;
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] !== "@") break;
    const match = source.slice(cursor).match(/^@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping)\b/);
    if (!match) break;
    const call = annotationCall(source, cursor, match[1]);
    if (!call) {
      issues.push(issue("ANNOTATION_UNRESOLVED", `${file}: malformed @${match[1]}`));
      break;
    }
    const pathValue = mappingPath(call.content, match[1].replace("Mapping", ""), file, issues);
    values.push({ method: match[1].replace("Mapping", "").toUpperCase(), path: pathValue, end: call.end });
    cursor = call.end;
  }
  return values;
}

function parseClassMapping(source, className, file, issues) {
  const marker = source.indexOf("@RequestMapping");
  if (marker < 0) {
    issues.push(issue("CONTROLLER_MAPPING_MISSING", `${file}: ${className} has no literal class @RequestMapping`));
    return null;
  }
  const call = annotationCall(source, marker, "RequestMapping");
  if (!call) {
    issues.push(issue("DYNAMIC_MAPPING_UNRESOLVED", `${file}: malformed class @RequestMapping`));
    return null;
  }
  return mappingPath(call.content, "Request", file, issues);
}

function findMethodDeclaration(source, from) {
  let cursor = from;
  while (cursor < source.length) {
    while (/\s/.test(source[cursor] ?? "")) cursor += 1;
    if (source[cursor] !== "@") break;
    const annotation = source.slice(cursor).match(/^@([A-Za-z_$][\w$]*)/);
    if (!annotation) break;
    const call = annotationCall(source, cursor, annotation[1]);
    if (!call) return null;
    cursor = call.end;
  }
  const match = /\b(?:(?:public|protected|private)\s+)?([A-Za-z_$][\w$]*(?:\s*<[^{}()]+>)?(?:\[\])?(?:\s+)?(?:[?\w$.,<>\[\]]*)?)\s+([A-Za-z_$][\w$]*)\s*\(/g;
  match.lastIndex = cursor;
  const declaration = match.exec(source);
  return declaration?.index === cursor ? declaration : null;
}

function methodBody(source, declaration) {
  const open = source.indexOf("{", declaration.index);
  if (open < 0) return { body: "", end: source.length };
  const close = balancedEnd(source, open, "{", "}");
  return { body: source.slice(open, close < 0 ? source.length : close + 1), end: close < 0 ? source.length : close + 1 };
}

function parseParameter(raw, kind, issues, controller) {
  const withoutAnnotations = normalizeType(raw);
  const nameMatch = withoutAnnotations.match(/([A-Za-z_$][\w$]*)\s*$/);
  if (!nameMatch) {
    issues.push(issue("PARAMETER_UNRESOLVED", `${controller}: ${kind} parameter cannot be resolved`));
    return null;
  }
  const name = nameMatch[1];
  const type = withoutAnnotations.slice(0, nameMatch.index).trim();
  const requestAnnotation = annotations(raw).find((value) => value.name === kind);
  const args = requestAnnotation?.args ?? "";
  const explicitName = args.match(/(?:name|value)\s*=\s*"([^"]+)"/)?.[1] ?? null;
  const defaultValue = args.match(/defaultValue\s*=\s*"([^"]*)"/)?.[1] ?? null;
  const requiredArg = args.match(/required\s*=\s*(true|false)/)?.[1];
  const required =
    kind === "PathVariable"
      ? true
      : requiredArg !== "false" && defaultValue === null;
  return {
    name: explicitName ?? name,
    type,
    required,
    defaultValue,
    constraints: annotationText(raw),
  };
}

function parseMethodParameters(source, open, close, issues, controller) {
  const values = [];
  for (const raw of splitTopLevel(source.slice(open + 1, close))) {
    const annotationNames = new Set(annotations(raw).map((value) => value.name));
    if (annotationNames.has("RequestBody")) {
      if (values.some((value) => value.kind === "body")) {
        issues.push(issue("MULTIPLE_REQUEST_BODIES", `${controller}: endpoint has multiple @RequestBody parameters`));
        continue;
      }
      const parsed = parseParameter(raw, "RequestBody", issues, controller);
      if (parsed) values.push({ kind: "body", dto: parsed.type, ...parsed });
    } else if (annotationNames.has("PathVariable")) {
      const parsed = parseParameter(raw, "PathVariable", issues, controller);
      if (parsed) values.push({ kind: "path", ...parsed });
    } else if (annotationNames.has("RequestParam")) {
      const parsed = parseParameter(raw, "RequestParam", issues, controller);
      if (parsed) values.push({ kind: "query", ...parsed });
    }
  }
  return values.sort((left, right) =>
    `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`, "en"),
  );
}

function genericParts(type) {
  const match = type.match(/^([A-Za-z_$][\w$]*)<(.+)>$/s);
  if (!match) return null;
  return { wrapper: match[1], argument: match[2] };
}

function responseShape(returnType, operationId, issues) {
  const type = returnType.replace(/\s+/g, "").replace(/\?extends/g, "?");
  if (type === "void") return { kind: "none" };
  const generic = genericParts(type);
  if (!generic) return { kind: "declared" };
  if (GENERIC_RESPONSE_WRAPPERS.has(generic.wrapper) && generic.argument) {
    return { kind: generic.wrapper === "ResponseEntity" ? "entity" : generic.wrapper === "PageEnvelope" ? "page-envelope" : "page-result" };
  }
  if (type === "Map<String,Object>" && operationId === "SystemInfoController#info") {
    return { kind: "explicit-opaque-map", reason: ALLOWED_OPAQUE_RESPONSE };
  }
  issues.push(issue("GENERIC_RESPONSE_UNRESOLVED", `${operationId}: response type ${returnType} is not an allowed resolved wrapper`));
  return { kind: "unresolved" };
}

function parseStatus(annotationBlock, body, returnType, operationId, issues) {
  const explicit = annotationBlock.match(/@ResponseStatus\s*\(\s*HttpStatus\.([A-Z_]+)\s*\)/)?.[1];
  if (explicit) return explicit;
  if (returnType.startsWith("ResponseEntity<")) {
    const status = body.match(/ResponseEntity\s*\.\s*(created|status|ok|accepted|noContent)\s*\(/);
    if (!status) {
      issues.push(issue("RESPONSE_STATUS_UNRESOLVED", `${operationId}: ResponseEntity status is not statically resolved`));
      return "UNRESOLVED";
    }
    const names = { created: "CREATED", status: body.match(/ResponseEntity\s*\.\s*status\s*\(\s*HttpStatus\.([A-Z_]+)/)?.[1] ?? "UNRESOLVED", ok: "OK", accepted: "ACCEPTED", noContent: "NO_CONTENT" };
    if (names[status[1]] === "UNRESOLVED") issues.push(issue("RESPONSE_STATUS_UNRESOLVED", `${operationId}: ResponseEntity.status argument is dynamic`));
    return names[status[1]];
  }
  return "OK";
}

function resolveAuthority(expression, constants, issues, location) {
  const values = new Set();
  for (const match of expression.matchAll(/has(?:Any)?Authority\s*\(([^)]*)\)/g)) {
    for (const argument of splitTopLevel(match[1])) {
      const literal = argument.trim().match(/^'([^']+)'$/s);
      if (literal && !/[+\"']/.test(literal[1])) values.add(literal[1]);
    }
  }
  for (const match of expression.matchAll(/([A-Za-z_$][\w$]*\.[A-Z][A-Z0-9_]*)/g)) {
    const resolved = constants.get(match[1]);
    if (resolved) values.add(resolved);
  }
  if (values.size === 0) issues.push(issue("AUTHORITY_UNRESOLVED", `${location}: @PreAuthorize authority is not statically resolvable`));
  return [...values].sort((left, right) => left.localeCompare(right, "en"));
}

function javaConstants(files) {
  const values = new Map();
  for (const file of files) {
    const className = path.basename(file.relative, ".java");
    const source = stripJavaComments(file.content);
    for (const match of source.matchAll(/(?:public\s+)?static\s+final\s+String\s+([A-Z][A-Z0-9_]*)\s*=\s*"([^"]+)"\s*;/g)) {
      values.set(`${className}.${match[1]}`, match[2]);
    }
  }
  return values;
}

function securityRules(files, constants, issues) {
  const securityFile = files.find((file) => file.relative.endsWith("/config/SecurityConfig.java"));
  if (!securityFile) {
    issues.push(issue("SECURITY_CONFIG_MISSING", "SecurityConfig.java was not found"));
    return { publicPaths: new Set(), platformPrefix: null, platformAuthority: null, tenantExit: null };
  }
  const source = stripJavaComments(securityFile.content);
  const publicStart = source.indexOf(".requestMatchers(");
  const publicEnd = source.indexOf(").permitAll()", publicStart);
  const publicBlock = publicStart >= 0 && publicEnd >= 0 ? source.slice(publicStart, publicEnd) : "";
  const publicPaths = new Set([...publicBlock.matchAll(/"(\/api\/v1\/[^"\n]+)"/g)].map((m) => m[1]));
  if (publicPaths.size === 0) issues.push(issue("PUBLIC_RULES_UNRESOLVED", "SecurityConfig permitAll API paths were not resolved"));
  const platformMatch = source.match(/\.requestMatchers\(\s*"(\/api\/v1\/platform-admin\/\*\*)"\s*\)\s*\.hasAuthority\(([^)]+)\)/);
  const platformAuthority = platformMatch ? (constants.get(platformMatch[2].trim()) ?? platformMatch[2].trim().replace(/^['"]|['"]$/g, "")) : null;
  if (!platformMatch || !platformAuthority) issues.push(issue("PLATFORM_RULE_UNRESOLVED", "platform-admin path guard is not statically resolved"));
  const tenantExitMatch = source.match(/\.requestMatchers\(\s*HttpMethod\.([A-Z]+)\s*,\s*"([^"]+)"\s*\)\s*\.hasAuthority\(([^)]+)\)/);
  const tenantExit = tenantExitMatch ? {
    method: tenantExitMatch[1],
    path: tenantExitMatch[2],
    authority: constants.get(tenantExitMatch[3].trim()) ?? tenantExitMatch[3].trim().replace(/^['"]|['"]$/g, ""),
  } : null;
  if (!tenantExit) issues.push(issue("TENANT_EXIT_RULE_UNRESOLVED", "platform tenant-session exit guard is not statically resolved"));
  return { publicPaths, platformPrefix: platformMatch?.[1] ?? null, platformAuthority, tenantExit };
}

function controllerFacts(files, declarations, constants, rules, issues) {
  const endpoints = [];
  const usedDtoNames = new Set();
  const controllerFiles = files.filter((file) => file.relative.endsWith("Controller.java"));
  for (const file of controllerFiles) {
    const parsed = parseImportsAndClass(file.content, file.relative);
    if (!parsed) continue;
    const classPath = parseClassMapping(parsed.source, parsed.className, file.relative, issues);
    if (classPath === null) continue;
    const className = parsed.className;
    const classMarker = parsed.source.indexOf(`class ${className}`);
    const methodSource = parsed.source.slice(classMarker);
    for (const match of methodSource.matchAll(/@(GetMapping|PostMapping|PutMapping|PatchMapping|DeleteMapping)\b/g)) {
      const mappingStart = classMarker + match.index;
      const routes = routeAnnotations(parsed.source, mappingStart, file.relative, issues);
      if (routes.length !== 1 || routes[0].path === null) continue;
      const route = routes[0];
    const declaration = findMethodDeclaration(parsed.source, route.end);
      if (!declaration) {
        issues.push(issue("METHOD_UNRESOLVED", `${file.relative}: mapping has no public method declaration`));
        continue;
      }
      const open = parsed.source.indexOf("(", declaration.index);
      const close = balancedEnd(parsed.source, open);
      if (close < 0) {
        issues.push(issue("METHOD_UNRESOLVED", `${file.relative}: method parameter list is not balanced`));
        continue;
      }
      const body = methodBody(parsed.source, declaration);
      const beforeMethod = parsed.source.slice(route.end, declaration.index);
      const operationId = `${className}#${declaration[2]}`;
      const fullPath = joinPath(classPath, route.path);
      const params = parseMethodParameters(parsed.source, open, close, issues, operationId);
      const bodyParam = params.find((value) => value.kind === "body");
      if (bodyParam) {
        const declaration = resolveDeclaration(declarations, bodyParam.dto, parsed, issues);
        if (declaration) {
          bodyParam.dto = declaration.qualifiedName;
          usedDtoNames.add(declaration.qualifiedName);
        }
      }
      const preAuthorizeIndex = beforeMethod.indexOf("@PreAuthorize");
      const preAuthorizeCall = preAuthorizeIndex >= 0
        ? annotationCall(beforeMethod, preAuthorizeIndex, "PreAuthorize")
        : null;
      const preAuthorize = preAuthorizeCall?.content ?? null;
      let trustDomain;
      let authorities;
      if (rules.publicPaths.has(fullPath)) {
        trustDomain = "public";
        authorities = [];
      } else if (fullPath.startsWith("/api/v1/platform-admin/")) {
        trustDomain = "platform-admin";
        const special = rules.tenantExit && rules.tenantExit.method === route.method && rules.tenantExit.path === fullPath;
        authorities = [special ? rules.tenantExit.authority : rules.platformAuthority].filter(Boolean);
        if (preAuthorize) issues.push(issue("TRUST_DOMAIN_MIXED", `${operationId}: platform-admin endpoint must use the SecurityConfig platform guard, not a tenant @PreAuthorize`));
      } else {
        trustDomain = "tenant";
        authorities = preAuthorize ? resolveAuthority(preAuthorize, constants, issues, operationId) : [];
        if (!preAuthorize && !fullPath.startsWith("/api/v1/system/")) {
          authorities = ["authenticated-tenant-session"];
        }
      }
      const returnType = declaration[1].replace(/\s+/g, "").trim();
      const response = responseShape(returnType, operationId, issues);
      const status = parseStatus(beforeMethod, body.body, returnType, operationId, issues);
      endpoints.push({
        operationId,
        controller: className,
        source: file.relative,
        method: route.method,
        path: fullPath,
        trustDomain,
        requiredAuthorities: authorities,
        pathParameters: params.filter((value) => value.kind === "path").map(({ kind, ...value }) => value),
        queryParameters: params.filter((value) => value.kind === "query").map(({ kind, ...value }) => value),
        requestBody: bodyParam ? { dto: bodyParam.dto } : null,
        success: { status, responseType: returnType, responseShape: response },
      });
    }
  }
  return { endpoints: endpoints.sort((left, right) => left.operationId.localeCompare(right.operationId, "en")), usedDtoNames };
}

function requestSchemas(declarations, usedDtoNames, controllerFactsResult, issues) {
  const schemas = new Map();
  const queue = [...usedDtoNames];
  const byQualifiedName = new Map();
  for (const values of declarations.values()) {
    for (const value of values) byQualifiedName.set(value.qualifiedName, value);
  }
  while (queue.length) {
    const name = queue.shift();
    if (schemas.has(name)) continue;
    const declaration = byQualifiedName.get(name);
    if (!declaration) continue;
    schemas.set(name, {
      name: declaration.qualifiedName,
      source: declaration.file,
      kind: declaration.kind,
      fields: declaration.fields.sort((left, right) => left.name.localeCompare(right.name, "en")),
    });
    for (const field of declaration.fields) {
      const nested = field.type.match(/\b([A-Z][A-Za-z0-9_$]*(?:Request|Command|Line))\b/)?.[1];
      if (nested && declarations.has(nested)) {
        const nestedDeclaration = (declarations.get(nested) ?? []).find(
          (value) => value.packageName === declaration.packageName,
        ) ?? ((declarations.get(nested) ?? []).length === 1 ? declarations.get(nested)[0] : null);
        if (nestedDeclaration) queue.push(nestedDeclaration.qualifiedName);
        else issues.push(issue("DTO_NESTED_UNRESOLVED", `${declaration.qualifiedName}: nested DTO ${nested} is ambiguous`));
      }
    }
  }
  return [...schemas.values()].sort((left, right) => left.name.localeCompare(right.name, "en"));
}

function adviceTargets(source) {
  const annotationIndex = source.indexOf("@RestControllerAdvice");
  if (annotationIndex < 0) return [];
  const call = annotationCall(source, annotationIndex, "RestControllerAdvice");
  if (!call) return [];
  return [...call.content.matchAll(/([A-Za-z_$][\w$]*)\.class/g)].map((m) => m[1]);
}

function errorMappings(files, issues) {
  const values = [];
  for (const file of files.filter((value) => value.relative.includes("ExceptionHandler.java"))) {
    const source = stripJavaComments(file.content);
    const targets = adviceTargets(source);
    if (targets.length === 0) {
      issues.push(issue("ERROR_TARGET_UNRESOLVED", `${file.relative}: @RestControllerAdvice targets are unresolved`));
      continue;
    }
    for (const match of source.matchAll(/@ExceptionHandler\b/g)) {
      const call = annotationCall(source, match.index, "ExceptionHandler");
      if (!call) {
        issues.push(issue("ERROR_MAPPING_UNRESOLVED", `${file.relative}: malformed @ExceptionHandler`));
        continue;
      }
      const exceptions = call.content
        .replace(/[{}]/g, "")
        .split(",")
        .map((value) => value.trim().replace(/\.class$/, ""))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right, "en"));
      const method = findMethodDeclaration(source, call.end);
      if (!method || exceptions.length === 0) {
        issues.push(issue("ERROR_MAPPING_UNRESOLVED", `${file.relative}: exception handler method is unresolved`));
        continue;
      }
      const body = methodBody(source, method).body;
      const annotationBlock = source.slice(call.end, method.index);
      const status = annotationBlock.match(/@ResponseStatus\s*\(\s*HttpStatus\.([A-Z_]+)/)?.[1]
        ?? body.match(/error\s*\(\s*HttpStatus\.([A-Z_]+)/)?.[1]
        ?? body.match(/ResponseEntity\s*\.\s*status\s*\(\s*HttpStatus\.([A-Z_]+)/)?.[1]
        ?? null;
      if (!status) {
        issues.push(issue("ERROR_STATUS_UNRESOLVED", `${file.relative}: ${exceptions.join(",")} has no static HTTP status`));
      }
      const responseType = method[1].replace(/\s+/g, "");
      const codes = [...body.matchAll(/(?:new\s+(?:SecurityErrorResponse|ApiError)\s*\(\s*|error\s*\([^,]+,\s*)"([a-z0-9_]+)"/g)]
        .map((value) => value[1])
        .sort((left, right) => left.localeCompare(right, "en"));
      if (codes.length === 0) issues.push(issue("ERROR_CODE_UNRESOLVED", `${file.relative}: ${exceptions.join(",")} has no explicit error code`));
      for (const target of targets) {
        values.push({ advice: file.relative, controller: target, exceptions, status: status ?? "UNRESOLVED", responseType, codes });
      }
    }
  }
  return values.sort((left, right) =>
    `${left.controller}:${left.exceptions.join(",")}`.localeCompare(`${right.controller}:${right.exceptions.join(",")}`, "en"),
  );
}

function securityErrors(files, constants, issues) {
  const file = files.find((value) => value.relative.endsWith("/config/SecurityConfig.java"));
  if (!file) return [];
  const source = stripJavaComments(file.content);
  const values = [];
  const entry = source.match(/authenticationEntryPoint\s*\([^=]*?writeSecurityError\s*\(\s*response\s*,\s*(\d+)\s*,\s*"([^"]+)"/s);
  const denied = source.match(/accessDeniedHandler\s*\([^=]*?writeSecurityError\s*\(\s*response\s*,\s*(\d+)\s*,\s*"([^"]+)"/s);
  if (!entry || !denied) {
    issues.push(issue("SECURITY_ERROR_UNRESOLVED", "SecurityConfig security error mappings are not statically resolved"));
  } else {
    values.push({ source: file.relative, kind: "authentication-entry-point", status: Number(entry[1]), code: entry[2], responseType: "inline-json" });
    values.push({ source: file.relative, kind: "access-denied-handler", status: Number(denied[1]), code: denied[2], responseType: "inline-json" });
  }
  return values;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonical(value) {
  return JSON.stringify(value);
}

function integrityValue(baseline) {
  const copy = JSON.parse(JSON.stringify(baseline));
  delete copy.integritySha256;
  return sha256(canonical(copy));
}

function relevantSourceFiles(files, endpoints, schemas, errorValues) {
  const wanted = new Set([
    "platform/backend/src/main/java/cn/xzkj/erp/config/SecurityConfig.java",
    ...endpoints.map((value) => value.source),
    ...schemas.map((value) => value.source),
    ...errorValues.map((value) => value.advice),
  ]);
  return files
    .filter((value) =>
      wanted.has(value.relative) ||
      value.relative.endsWith("PermissionCodes.java") ||
      value.relative.endsWith("PlatformAdminAuthorities.java"),
    )
    .sort((left, right) => left.relative.localeCompare(right.relative, "en"))
    .map((value) => ({ path: value.relative, sha256: sha256(value.content) }));
}

export function generateApiContract(repositoryRoot) {
  const root = validateTree(repositoryRoot, false);
  const files = walkJavaFiles(root);
  const cleanFiles = files.map((file) => ({ ...file, source: stripJavaComments(file.content) }));
  const constants = javaConstants(files);
  const issues = [];
  rejectSpringMetaAnnotations(files, issues);
  const declarations = parseDeclarations(files);
  const rules = securityRules(files, constants, issues);
  const facts = controllerFacts(files, declarations, constants, rules, issues);
  const errors = errorMappings(files, issues);
  const schemas = requestSchemas(declarations, facts.usedDtoNames, facts.endpoints, issues);
  const security = securityErrors(files, constants, issues);
  const baseline = {
    schemaVersion: 1,
    generator: GENERATOR_VERSION,
    sourceRoot: JAVA_ROOT_RELATIVE,
    sourceFiles: relevantSourceFiles(files, facts.endpoints, schemas, errors),
    endpoints: facts.endpoints,
    requestSchemas: schemas,
    errorMappings: errors,
    securityErrors: security,
  };
  baseline.integritySha256 = integrityValue(baseline);
  return { root, baseline, issues: deduplicateIssues(issues), allFiles: files };
}

function readBaseline(root, issues) {
  const target = path.resolve(root, BASELINE_RELATIVE);
  if (!fs.existsSync(target)) {
    issues.push(issue("BASELINE_MISSING", "API contract baseline does not exist"));
    return null;
  }
  const metadata = fs.lstatSync(target);
  if (metadata.isSymbolicLink()) {
    issues.push(issue("BASELINE_SYMLINK_REJECTED", "API contract baseline must not be a symbolic link"));
    return null;
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    issues.push(issue("BASELINE_INVALID_JSON", "API contract baseline is not valid JSON"));
    return null;
  }
  if (value.schemaVersion !== 1 || value.generator !== GENERATOR_VERSION) {
    issues.push(issue("BASELINE_SCHEMA_UNSUPPORTED", "API contract baseline schema or generator version is unsupported"));
  }
  if (typeof value.integritySha256 !== "string" || integrityValue(value) !== value.integritySha256) {
    issues.push(issue("BASELINE_INTEGRITY_MISMATCH", "API contract baseline integrity check failed"));
  }
  return value;
}

function endpointMap(values) {
  return new Map(values.map((value) => [value.operationId, value]));
}

function schemaMap(values) {
  return new Map(values.map((value) => [value.name, value]));
}

function compareContract(baseline, current, issues) {
  if (!baseline) return;
  const oldEndpoints = endpointMap(baseline.endpoints ?? []);
  const newEndpoints = endpointMap(current.endpoints ?? []);
  for (const [operationId, oldValue] of oldEndpoints) {
    const next = newEndpoints.get(operationId);
    if (!next) {
      issues.push(issue("ENDPOINT_REMOVED", `${operationId}: endpoint was removed`));
      continue;
    }
    if (oldValue.method !== next.method || oldValue.path !== next.path) {
      issues.push(issue("ENDPOINT_METHOD_OR_PATH_CHANGED", `${operationId}: method/path changed from ${oldValue.method} ${oldValue.path} to ${next.method} ${next.path}`));
    }
    if (oldValue.trustDomain !== next.trustDomain) {
      issues.push(issue("TRUST_DOMAIN_CHANGED", `${operationId}: trust domain changed from ${oldValue.trustDomain} to ${next.trustDomain}`));
    }
    if (canonical(oldValue.requiredAuthorities) !== canonical(next.requiredAuthorities)) {
      issues.push(issue("AUTHORITY_CHANGED", `${operationId}: required authority changed`));
    }
    for (const kind of ["pathParameters", "queryParameters"]) {
      if (canonical(oldValue[kind]) !== canonical(next[kind])) {
        issues.push(issue("REQUEST_PARAMETER_CHANGED", `${operationId}: ${kind} changed`));
      }
    }
    if (canonical(oldValue.requestBody) !== canonical(next.requestBody)) {
      issues.push(issue("REQUEST_DTO_CHANGED", `${operationId}: request body DTO changed`));
    }
    if (canonical(oldValue.success) !== canonical(next.success)) {
      issues.push(issue("RESPONSE_CONTRACT_CHANGED", `${operationId}: success status or response type changed`));
    }
  }
  for (const operationId of newEndpoints.keys()) {
    if (!oldEndpoints.has(operationId)) issues.push(issue("NEW_ENDPOINT_REQUIRES_REVIEW", `${operationId}: new endpoint requires explicit baseline refresh and human review`));
  }

  const oldSchemas = schemaMap(baseline.requestSchemas ?? []);
  const newSchemas = schemaMap(current.requestSchemas ?? []);
  for (const [name, oldValue] of oldSchemas) {
    const next = newSchemas.get(name);
    if (!next) {
      issues.push(issue("REQUEST_DTO_REMOVED", `${name}: request DTO schema was removed`));
      continue;
    }
    const oldFields = new Map(oldValue.fields.map((value) => [value.name, value]));
    const newFields = new Map(next.fields.map((value) => [value.name, value]));
    for (const [fieldName, oldField] of oldFields) {
      const newField = newFields.get(fieldName);
      if (!newField) {
        issues.push(issue("REQUEST_FIELD_REMOVED", `${name}.${fieldName}: request field was removed or renamed`));
        continue;
      }
      if (oldField.type !== newField.type) issues.push(issue("REQUEST_FIELD_TYPE_CHANGED", `${name}.${fieldName}: type changed from ${oldField.type} to ${newField.type}`));
      if (oldField.required !== newField.required) issues.push(issue("REQUEST_FIELD_REQUIREDNESS_CHANGED", `${name}.${fieldName}: requiredness changed`));
      if (canonical(oldField.constraints) !== canonical(newField.constraints)) issues.push(issue("REQUEST_FIELD_CONSTRAINT_CHANGED", `${name}.${fieldName}: validation constraints changed`));
    }
    for (const [fieldName, newField] of newFields) {
      if (!oldFields.has(fieldName)) issues.push(issue(newField.required ? "REQUEST_REQUIRED_FIELD_ADDED" : "REQUEST_FIELD_ADDED", `${name}.${fieldName}: request field was added`));
    }
  }
  for (const name of newSchemas.keys()) {
    if (!oldSchemas.has(name)) issues.push(issue("NEW_REQUEST_DTO_REQUIRES_REVIEW", `${name}: new request DTO requires review`));
  }
  const oldErrors = canonical(baseline.errorMappings ?? []);
  const newErrors = canonical(current.errorMappings ?? []);
  if (oldErrors !== newErrors) issues.push(issue("ERROR_MAPPING_CHANGED", "explicit controller error mappings changed"));
  if (canonical(baseline.securityErrors ?? []) !== canonical(current.securityErrors ?? [])) issues.push(issue("SECURITY_ERROR_MAPPING_CHANGED", "explicit security error mapping changed"));
}

function deduplicateIssues(issues) {
  const unique = new Map();
  for (const value of issues) unique.set(`${value.code}\0${value.message}`, value);
  return [...unique.values()].sort((left, right) => left.code.localeCompare(right.code, "en") || left.message.localeCompare(right.message, "en"));
}

export function inspectApiContract(repositoryRoot) {
  const generated = generateApiContract(repositoryRoot);
  const issues = [...generated.issues];
  const baseline = readBaseline(generated.root, issues);
  compareContract(baseline, generated.baseline, issues);
  const uniqueIssues = deduplicateIssues(issues);
  return {
    root: generated.root,
    baseline: generated.baseline,
    issues: uniqueIssues,
    summary: {
      endpoints: generated.baseline.endpoints.length,
      requestSchemas: generated.baseline.requestSchemas.length,
      errorMappings: generated.baseline.errorMappings.length,
      securityErrors: generated.baseline.securityErrors.length,
      sourceFiles: generated.baseline.sourceFiles.length,
      skipped: 0,
    },
  };
}

export function runApiContractGate(repositoryRoot) {
  const result = inspectApiContract(repositoryRoot);
  if (result.issues.length > 0) throw new ApiContractGateError(result.issues);
  return result;
}

function writeBaseline(root, baseline) {
  const target = path.resolve(root, BASELINE_RELATIVE);
  const directory = path.dirname(target);
  if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) {
    throw new ApiContractGateError([
      issue("BASELINE_SYMLINK_REJECTED", "API contract baseline directory must not be a symbolic link"),
    ]);
  }
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) {
    throw new ApiContractGateError([
      issue("BASELINE_SYMLINK_REJECTED", "API contract baseline must not be a symbolic link"),
    ]);
  }
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
}

function printSuccess(result, mode = "check") {
  const summary = result.summary;
  process.stdout.write([
    `PASS API contract ${mode}`,
    `endpoints=${summary.endpoints}`,
    `request_schemas=${summary.requestSchemas}`,
    `error_mappings=${summary.errorMappings}`,
    `security_errors=${summary.securityErrors}`,
    `source_files=${summary.sourceFiles}`,
    "skipped=0",
  ].join("\n") + "\n");
}

function printFailure(error) {
  const issues = error instanceof ApiContractGateError ? error.issues : [issue("GATE_INTERNAL_ERROR", "API contract gate could not complete")];
  process.stderr.write(["FAIL API contract gate", ...issues.map((value) => `[${value.code}] ${value.message}`), "skipped=0"].join("\n") + "\n");
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    try {
      printSuccess(runApiContractGate(LOCKED_REPOSITORY_ROOT));
    } catch (error) {
      printFailure(error);
      process.exitCode = 1;
    }
  } else if (args.length === 2 && args[0] === "--refresh-baseline" && args[1] === "--reviewed") {
    try {
      const generated = generateApiContract(LOCKED_REPOSITORY_ROOT);
      if (generated.issues.length > 0) throw new ApiContractGateError(generated.issues);
      writeBaseline(generated.root, generated.baseline);
      printSuccess({ summary: {
        endpoints: generated.baseline.endpoints.length,
        requestSchemas: generated.baseline.requestSchemas.length,
        errorMappings: generated.baseline.errorMappings.length,
        securityErrors: generated.baseline.securityErrors.length,
        sourceFiles: generated.baseline.sourceFiles.length,
      } }, "baseline refresh");
      process.stdout.write("REVIEW REQUIRED: inspect the generated baseline diff before committing.\n");
    } catch (error) {
      printFailure(error);
      process.exitCode = 1;
    }
  } else {
    printFailure(new ApiContractGateError([issue("EXTERNAL_INPUT_REJECTED", "the gate accepts no repository path, URL, environment, or unrecognized CLI input")]));
    process.exitCode = 2;
  }
}
