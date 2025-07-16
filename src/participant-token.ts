// participantToken.ts
import { decodeJwt, jwtVerify, JWTPayload, SignJWT } from "jose";

/**
 * Represents a simple "Grant" given to a participant, with a name and optional scope.
 */
export class ParticipantGrant {
    public name: string;
    public scope?: string;

    constructor({ name, scope }: { name: string; scope?: string }) {
        this.name = name;
        this.scope = scope;
    }

    toJson(): Record<string, any> {
        return {
            name: this.name,
            scope: this.scope,
        };
    }

    static fromJson(json: Record<string, any>): ParticipantGrant {
        return new ParticipantGrant({
            name: json["name"] as string,
            scope: json["scope"] as string | undefined,
        });
    }
}

/**
 * Represents a token structure for a participant, including
 * a name, projectId, apiKeyId, and list of grants.
 */
export class ParticipantToken {
    public name: string;
    public projectId?: string;
    public apiKeyId?: string;

    public grants: ParticipantGrant[];
    public extra?: Record<string, any>;

    constructor({
        name,
        projectId,
        apiKeyId,
        extra,
        grants,
    }: {
        name: string;
        projectId?: string;
        apiKeyId?: string;
        extra?: Record<string, any>;
        grants?: ParticipantGrant[];
    }) {
        this.name = name;
        this.projectId = projectId;
        this.apiKeyId = apiKeyId;
        this.extra = extra ?? {};
        this.grants = grants ?? [];
    }

    /**
     * Indicates if this token has a role grant that matches "agent".
     */
    get isAgent(): boolean {
        for (const grant of this.grants) {
            if (grant.name === "role" && grant.scope === "agent") {
                return true;
            }
        }
        return false;
    }

    /**
     * Adds a role grant, e.g. "agent" or something else.
     */
    addRoleGrant(role: string) {
        this.grants.push(new ParticipantGrant({ name: "role", scope: role }));
    }

    /**
     * Adds a 'room' grant to the participant token.
     */
    addRoomGrant(roomName: string) {
        this.grants.push(new ParticipantGrant({ name: "room", scope: roomName }));
    }

    /**
     * Returns this object as a JSON-compatible Map.
     */
    toJson(): Record<string, any> {
        return {
            name: this.name,
            ...(this.projectId ? { sub: this.projectId } : {}),
            ...(this.apiKeyId ? { kid: this.apiKeyId } : {}),
            grants: this.grants.map((g) => g.toJson()),
        };
    }

    /**
     * Encodes this object as a JWT string (async).
     * If `token` is not provided, falls back to `process.env.MESHAGENT_SECRET`.
     * `extraPayload` merges additional data (stored in `this.extra`) into the JWT payload.
     */
    public async toJwt({ token }: {
        token: string;
    }): Promise<string> {
        // jose requires a Uint8Array key for HMAC
        const secretKey = new TextEncoder().encode(token);

        // Merge core token JSON plus any extras
        const payload: JWTPayload = {
            ...this.toJson(),
            ...this.extra,
        };

        // Sign using HS256
        const jwt = await new SignJWT(payload)
            .setProtectedHeader({ alg: "HS256", typ: "JWT" })
            .sign(secretKey);

        return jwt;
    }

    /**
     * Creates a ParticipantToken from a JSON Map.
     */
    static fromJson(json: Record<string, any>): ParticipantToken {
        const { name, sub, grants, kid, ...rest } = json;

        // The Dart code collected all unknown keys into `extra`.
        const extra: Record<string, any> = { ...rest };

        return new ParticipantToken({
            name: name as string,
            projectId: sub as string,
            apiKeyId: kid as string,
            grants: (grants as Array<any>)?.map((g) =>
                ParticipantGrant.fromJson(g as Record<string, any>)
            ),
            extra,
        });
    }

    /**
     * Decodes a JWT string to create a ParticipantToken (async).
     * If `token` is not provided, tries to read from `process.env.MESHAGENT_SECRET`.
     * If `verify = false`, only decodes without verifying signature.
     */
    static async fromJwt(jwtStr: string, options: { token: string; verify?: boolean }): Promise<ParticipantToken> {
        const { token, verify = true } = options;

        if (verify) {
            const secretKey = new TextEncoder().encode(token);

            // Verify signature and decode
            const { payload } = await jwtVerify(jwtStr, secretKey, {
                // optional: specify allowed algorithms
                algorithms: ["HS256"],
            });

            return ParticipantToken.fromJson(payload as Record<string, any>);
        } else {
            // decode without verifying
            try {
                const payload = decodeJwt(jwtStr);

                return ParticipantToken.fromJson(payload as Record<string, any>);

            } catch (err) {
                throw new Error("Failed to decode JWT");
            }
        }
    }
}
