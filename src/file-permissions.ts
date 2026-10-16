export type FileAction = "list" | "read" | "write" | "delete" | "presign";
export type FileRole = "files_list" | "files_read" | "files_write" | "files_delete" | "files_presign";

export const FILE_ACTIONS: readonly FileAction[] = ["list", "read", "write", "delete", "presign"];

export function validateFilePath(value: string): string {
    if (typeof value !== "string" || /[\\\x00-\x1f\x7f-\x9f]/.test(value) ||
        (value !== "" && value.split("/").some(part => !part || part === "." || part === ".." || part === ".meshagent-directory" || part.startsWith(".meshagent-upload-")))) {
        throw new TypeError("Files paths must be canonical relative paths");
    }
    return value;
}

function descendant(parent: string, path: string): boolean {
    return parent === "" || path.startsWith(`${parent}/`);
}
export class FilePathRule {
    readonly path: string;
    readonly recursive: boolean;
    readonly actions: readonly FileAction[];
    readonly excludedPaths: readonly string[];

    constructor({ path, recursive, actions, excludedPaths = [] }: { path: string; recursive: boolean; actions: readonly FileAction[]; excludedPaths?: readonly string[] }) {
        this.path = validateFilePath(path);
        this.recursive = recursive;
        if (typeof recursive !== "boolean" || actions.some(action => !FILE_ACTIONS.includes(action)) || excludedPaths.length > 1000) throw new TypeError("Invalid file path policy");
        this.actions = Object.freeze([...actions]);
        this.excludedPaths = Object.freeze(excludedPaths.map(validateFilePath));
        Object.freeze(this);
    }

    allows(action: FileAction, path: string, { subtree = false }: { subtree?: boolean } = {}): boolean {
        validateFilePath(path);
        return this.actions.includes(action) && (!subtree || this.recursive) &&
            (path === this.path || (this.recursive && descendant(this.path, path))) &&
            !this.excludedPaths.some(excluded => path === excluded || descendant(excluded, path) || (subtree && descendant(path, excluded)));
    }

    toJson(): { path: string; recursive: boolean; actions: readonly FileAction[]; excluded_paths: readonly string[] } {
        return { path: this.path, recursive: this.recursive, actions: this.actions, excluded_paths: this.excludedPaths };
    }
}

export class FilesPolicy {
    readonly paths: readonly FilePathRule[];
    constructor({ paths = [] }: { paths?: readonly FilePathRule[] } = {}) {
        if (paths.length > 1000) throw new TypeError("Too many file policy paths");
        this.paths = Object.freeze(paths.map(rule => new FilePathRule(rule)));
        Object.freeze(this);
    }
    allows(action: FileAction, path: string, options: { subtree?: boolean } = {}): boolean {
        return this.paths.some(rule => rule.allows(action, path, options));
    }
    canListDirectory(path: string): boolean {
        validateFilePath(path);
        return this.allows("list", path) || this.paths.some(rule => rule.allows("list", rule.path) && descendant(path, rule.path));
    }
    static fromJson(value: unknown): FilesPolicy {
        if (!value || typeof value !== "object") throw new TypeError("Expected files policy");
        const paths = (value as { paths?: unknown }).paths ?? [];
        if (!Array.isArray(paths)) throw new TypeError("Expected files policy paths");
        return new FilesPolicy({ paths: paths.map(value => {
            if (!value || typeof value !== "object") throw new TypeError("Expected file rule");
            const rule = value as { path: string; recursive: boolean; actions: FileAction[]; excluded_paths?: string[] };
            return new FilePathRule({ path: rule.path, recursive: rule.recursive, actions: rule.actions, excludedPaths: rule.excluded_paths });
        }) });
    }
    toJson(): { paths: ReturnType<FilePathRule["toJson"]>[] } {
        return { paths: this.paths.map(rule => rule.toJson()) };
    }
}


export function storageRequestPath(path: string): string {
    while (path.startsWith("./")) path = path.slice(2);
    path = path.replace(/^\/+|\/+$/g, "");
    return validateFilePath(path === "." ? "" : path);
}

export function legacyStoragePolicy(paths?: readonly { path: string; readOnly: boolean }[]): FilesPolicy {
    if (!paths) return new FilesPolicy({ paths: [new FilePathRule({ path: "", recursive: true, actions: ["list", "read", "write", "delete"] })] });
    const previous: string[] = [];
    return new FilesPolicy({ paths: paths.map(grant => {
        const path = grant.path.replace(/^\/+|\/+$/g, "");
        const rule = new FilePathRule({ path, recursive: true, actions: grant.readOnly ? ["list", "read"] : ["list", "read", "write", "delete"], excludedPaths: previous });
        previous.push(path);
        return rule;
    }) });
}
