// This is to support the Auth0 Playground
declare var request: typeof import('request');
declare var _: typeof import('lodash');

// Auth0 Types, Interfaces and other structures
// ---------------------------------------------------

/**
 * @description Auth0 authentication protocol potential values
 * @link https://auth0.com/docs/rules/references/context-object
 */
enum ContextProtocol {
    OidcBasicProfile = 'oidc-basic-profile',
    OidcImplicitProfile = 'oidc-implicit-profile',
    OAuth2ResourceOwner = 'oauth2-resource-owner',
    OAuth2ResourceOwnerJwtBearer = 'oauth2-resource-owner-jwt-bearer',
    OAuth2Password = 'oauth2-password',
    OAuth2RefreshToken = 'oauth2-refresh-token',
    SAMLP = 'samlp',
    WSFed = 'wsfed',
    WSTrustUsernameMixed = 'wstrust-usernamemixed',
    Delegation = 'delegation',
    RedirectCallback = 'redirect-callback',
}

/**
 * @description Auth0 Context Object, passed into rules
 * @link https://auth0.com/docs/rules/references/context-object
 */
interface Context {
    sessionID: string,
    protocol: ContextProtocol,
    request: {
        userAgent: string,
        ip: string,
        hostname: string,
        query: string,
        geoip: {
            country_code: string,
            country_code3: string,
            country_name: string,
            city_name: string,
            latitude: string,
            longitude: string,
            time_zone: string,
            continent_code: string,
        }
    }
}

/**
 * @description Auth0 User Object, passed into rules
 * @link https://auth0.com/docs/rules/references/user-object
 */
interface User {
    app_metadata: object,
    created_at: Date,
    email: string,
    last_ip: string,
    last_login: Date,
    logins_count: number,
    last_password_reset: Date,
    password_set_date: Date,
    updated_at: Date,
    username: string,
    user_id: string,
    user_metadata: object
}

/**
 * @description Auth0 Callback passed into rules
 * @link: https://auth0.com/docs/rules#syntax
 */
interface Callback {
    (err: null | Error, user: User, context: Context): void
}

/**
 * @description Auth0 Rule Interface
 * @link https://auth0.com/docs/rules
 */
interface Rule {
    (user: User, context: Context, callback: Callback): void
}

// Cognition SDK
// ---------------------------------------------------

interface DecisionOptions {
    overrides?: CognitionRequest
}

enum ApiVersion {
    v1 = 'v1'
}

const enum DecisionStatus {
    allow = 'allow',
    review = 'review',
    reject = 'reject'
}

const enum Channel {
    web = 'web',
    desktop = 'desktop',
    app = 'app',
}

const enum LoginStatus {
    success = 'success',
    failure = 'failure'
}

const enum AuthenticationType {
    client_storage = 'client_storage',
    password = 'password',
    two_factor = 'two_factor',
    single_sign_on = 'single_sign_on',
    key = 'key',

    other = 'other' // @todo add to API
}

interface CognitionResponse {
    score: number,
    confidence: number,
    decision: DecisionStatus,
    signals: Array<string>
}

interface CognitionRequest {
    apiKey: string,
    eventId: string,
    dateTime: Date,
    ipAddress: string,
    _custom?: object,
    clientPayload?: object,
    login: {
        userId: string,
        channel: Channel,
        usedCaptcha: boolean,
        authenticationType?: AuthenticationType | null,
        status: LoginStatus,
        passwordUpdateTime: Date,
        userNameUpdateTime?: Date
    }
}

interface ConstructorOptions {
    apiKey: string,
    version: ApiVersion,
    auth: {
        userName: string,
        password: string
    },
    logger?: Logger,
    logLevel?: LogLevel
}

enum LogLevel {
    DEBUG = 4,
    INFO = 3,
    WARN = 2,
    ERROR = 1,
    NONE = 0
}

const SDK_NAME = 'Cognition';

class Logger {
    private readonly logLevel: LogLevel;

    constructor(logLevel: LogLevel) {
        this.logLevel = logLevel;
    }

    public debug(...args: any) {
        if (this.logLevel >= LogLevel.DEBUG) {
            console.debug(`${SDK_NAME} DEBUG:`, ...args);
        }
    }

    public info(...args: any) {
        if (this.logLevel >= LogLevel.INFO) {
            console.info(`${SDK_NAME} INFO:`, ...args);
        }
    }

    public warn(...args: any) {
        if (this.logLevel >= LogLevel.WARN) {
            console.warn(`${SDK_NAME} WARN:`, ...args);
        }
    }

    public error(...args: any) {
        if (this.logLevel >= LogLevel.ERROR) {
            console.error(`${SDK_NAME} ERROR:`, ...args);
        }
    }
}

class PrecognitiveError extends Error {
    public readonly isFraudulent: boolean;

    constructor(isFraudulent = true) {
        super('Precognitive: Reject Authentication');
        this.isFraudulent = isFraudulent;
    }
}

class HttpError extends Error {
    public readonly statusCode: number;
    public readonly response: object | null;
    public readonly body: any | null;

    constructor(statusCode: number, response: object | null = null, body: any = null) {
        super(`${SDK_NAME} - HTTP Error [${statusCode}]`);

        this.statusCode = statusCode;
        this.response = response;
        this.body = body;
    }
}

class Cognition {
    private readonly options: ConstructorOptions;
    private readonly logger: Logger;

    constructor(options: ConstructorOptions) {
        this.options = options;

        if (this.options.logger) {
            this.logger = this.options.logger;
        } else {
            this.logger = new Logger(this.options.logLevel || LogLevel.NONE);
        }
    }

    public async decision(user: User, context: Context, options: DecisionOptions): Promise<CognitionResponse> {
        const reqBody = this.buildBody(user, context, options);
        this.logger.debug(`REQUEST BODY - ${JSON.stringify(reqBody)}`);
        return new Promise((resolve, reject) => {
            request.post({
                baseUrl: _.get(this.options, 'apiUrl', 'https://api.precognitive.io'),
                uri: `/${this.options.version}/decision/login`,
                body: reqBody,
                json: true,
                timeout: 2000,
                auth: {
                    username: this.options.auth.userName,
                    password: this.options.auth.password
                }
            }, (err, response, body) => {
                if (response.statusCode === 200) {
                    this.logger.debug(`RESPONSE BODY - ${JSON.stringify(body)}`);
                    resolve(body);
                } else {
                    const ex = err ? err : new HttpError(response.statusCode, response, body);
                    this.logger.error(ex);
                    resolve({
                        score: 0,
                        confidence: 0,
                        decision: DecisionStatus.allow,
                        signals: ['unable-to-decision']
                    });
                }
            });
        });
    }

    public async autoDecision(user: User, context: Context, callback: Callback, options: DecisionOptions): Promise<void> {
        try {
            const response = await this.decision(user, context, options);
            let err: PrecognitiveError | null = null;

            if (!Cognition.isGoodLogin(response)) {
                err = new PrecognitiveError(true);
                this.logger.info('Auto-Decision - reject');
            }
            callback(err, user, context);
        } catch (err) {
            this.logger.error(err);

            // Default to auto-allow
            callback(null, user, context);
        }
    }

    public static isGoodLogin(decisionResponse: CognitionResponse): boolean {
        return _.includes([DecisionStatus.allow, DecisionStatus.review], decisionResponse.decision);
    }

    private getAuthenticationType(protocol: ContextProtocol): AuthenticationType | null {
        switch (protocol) {
            case ContextProtocol.OidcBasicProfile:
            case ContextProtocol.OidcImplicitProfile:
            case ContextProtocol.OAuth2ResourceOwner:
            case ContextProtocol.OAuth2Password:
                return AuthenticationType.password;
            case ContextProtocol.SAMLP:
            case ContextProtocol.WSFed:
            case ContextProtocol.WSTrustUsernameMixed:
                return AuthenticationType.single_sign_on;
            case ContextProtocol.OAuth2RefreshToken:
            case ContextProtocol.OAuth2ResourceOwnerJwtBearer:
                return AuthenticationType.key;
            default:
                this.logger.warn('Unable to determine AuthenticationType');
                return null;
            // @todo support `other`
            // return AuthenticationType.other;
        }
    }

    private buildBody(user: User, context: Context, options: DecisionOptions): CognitionRequest {
        return _.merge({
            apiKey: this.options.apiKey,
            eventId: context.sessionID,
            dateTime: new Date(),
            ipAddress: context.request.ip,
            login: {
                userId: user.user_id,
                channel: Channel.web, // @todo in future allow for mapping
                usedCaptcha: false,
                authenticationType: this.getAuthenticationType(context.protocol),
                status: LoginStatus.success,
                passwordUpdateTime: user.last_password_reset
            }
        }, _.get(options, 'overrides', {}));
    }
}
