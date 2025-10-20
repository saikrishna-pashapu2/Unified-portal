
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
  skip
} = require('./runtime/index-browser.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 5.22.0
 * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
 */
Prisma.prismaVersion = {
  client: "5.22.0",
  engine: "605197351a3c8bdd595af2d2a9bc3025bca48ea2"
}

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.NotFoundError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`NotFoundError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}



/**
 * Enums
 */

exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  ReadUncommitted: 'ReadUncommitted',
  ReadCommitted: 'ReadCommitted',
  RepeatableRead: 'RepeatableRead',
  Serializable: 'Serializable'
});

exports.Prisma.Activity_logsScalarFieldEnum = {
  id: 'id',
  user_id: 'user_id',
  action: 'action',
  details: 'details',
  ip_address: 'ip_address',
  timestamp: 'timestamp'
};

exports.Prisma.ActivitylogScalarFieldEnum = {
  user_id: 'user_id',
  action: 'action',
  resource: 'resource',
  resource_id: 'resource_id',
  details: 'details',
  ip_address: 'ip_address',
  user_agent: 'user_agent',
  status: 'status',
  error: 'error',
  request_id: 'request_id',
  id: 'id',
  created_at: 'created_at',
  updated_at: 'updated_at'
};

exports.Prisma.Ai_assistant_configScalarFieldEnum = {
  id: 'id',
  user_id: 'user_id',
  config_key: 'config_key',
  config_value: 'config_value',
  updated_at: 'updated_at'
};

exports.Prisma.Ai_conversationsScalarFieldEnum = {
  id: 'id',
  session_id: 'session_id',
  user_id: 'user_id',
  title: 'title',
  summary: 'summary',
  total_messages: 'total_messages',
  tokens_used: 'tokens_used',
  cost_usd: 'cost_usd',
  status: 'status',
  created_at: 'created_at',
  updated_at: 'updated_at'
};

exports.Prisma.Ai_entity_memoryScalarFieldEnum = {
  id: 'id',
  user_id: 'user_id',
  entity_type: 'entity_type',
  entity_key: 'entity_key',
  entity_data: 'entity_data',
  confidence_score: 'confidence_score',
  created_at: 'created_at',
  updated_at: 'updated_at'
};

exports.Prisma.Ai_knowledge_baseScalarFieldEnum = {
  id: 'id',
  knowledge_type: 'knowledge_type',
  topic: 'topic',
  title: 'title',
  content: 'content',
  source: 'source',
  confidence_score: 'confidence_score',
  usage_count: 'usage_count',
  last_used: 'last_used',
  created_at: 'created_at',
  updated_at: 'updated_at'
};

exports.Prisma.Ai_session_memoryScalarFieldEnum = {
  id: 'id',
  session_id: 'session_id',
  user_id: 'user_id',
  message_index: 'message_index',
  role: 'role',
  content: 'content',
  metadata: 'metadata',
  created_at: 'created_at',
  expires_at: 'expires_at'
};

exports.Prisma.ArticleScalarFieldEnum = {
  title: 'title',
  slug: 'slug',
  summary: 'summary',
  content: 'content',
  source: 'source',
  source_url: 'source_url',
  published_at: 'published_at',
  category: 'category',
  region: 'region',
  sector: 'sector',
  keywords: 'keywords',
  sentiment_score: 'sentiment_score',
  relevance_score: 'relevance_score',
  author_id: 'author_id',
  author_name: 'author_name',
  is_published: 'is_published',
  is_featured: 'is_featured',
  view_count: 'view_count',
  unique_viewers: 'unique_viewers',
  ai_summary: 'ai_summary',
  ai_summary_provider: 'ai_summary_provider',
  ai_summary_generated_at: 'ai_summary_generated_at',
  id: 'id',
  created_at: 'created_at',
  updated_at: 'updated_at',
  is_deleted: 'is_deleted',
  deleted_at: 'deleted_at'
};

exports.Prisma.Article_tagsScalarFieldEnum = {
  article_id: 'article_id',
  tag_id: 'tag_id'
};

exports.Prisma.ArticlestarScalarFieldEnum = {
  user_id: 'user_id',
  article_id: 'article_id',
  id: 'id',
  created_at: 'created_at',
  updated_at: 'updated_at'
};

exports.Prisma.ArticleviewScalarFieldEnum = {
  article_id: 'article_id',
  user_id: 'user_id',
  ip_address: 'ip_address',
  user_agent: 'user_agent',
  referrer: 'referrer',
  view_duration: 'view_duration',
  id: 'id',
  created_at: 'created_at',
  updated_at: 'updated_at'
};

exports.Prisma.Credit_articlesScalarFieldEnum = {
  id: 'id',
  title: 'title',
  date: 'date',
  content: 'content',
  link: 'link',
  source: 'source',
  matched_keywords: 'matched_keywords',
  region: 'region',
  sector: 'sector',
  starred: 'starred',
  starred_at: 'starred_at',
  summary: 'summary',
  url: 'url',
  created_at: 'created_at',
  updated_at: 'updated_at'
};

exports.Prisma.Email_alertsScalarFieldEnum = {
  id: 'id',
  email: 'email',
  alert_type: 'alert_type',
  subscription_date: 'subscription_date',
  active: 'active'
};

exports.Prisma.EventScalarFieldEnum = {
  title: 'title',
  slug: 'slug',
  description: 'description',
  event_type: 'event_type',
  location: 'location',
  venue: 'venue',
  is_virtual: 'is_virtual',
  virtual_link: 'virtual_link',
  start_date: 'start_date',
  end_date: 'end_date',
  timezone: 'timezone',
  registration_link: 'registration_link',
  registration_deadline: 'registration_deadline',
  max_attendees: 'max_attendees',
  price: 'price',
  currency: 'currency',
  organizer: 'organizer',
  organizer_email: 'organizer_email',
  organizer_phone: 'organizer_phone',
  sponsors: 'sponsors',
  agenda: 'agenda',
  speakers: 'speakers',
  tags: 'tags',
  source: 'source',
  source_url: 'source_url',
  is_published: 'is_published',
  is_featured: 'is_featured',
  is_cancelled: 'is_cancelled',
  cancellation_reason: 'cancellation_reason',
  created_by_id: 'created_by_id',
  view_count: 'view_count',
  id: 'id',
  created_at: 'created_at',
  updated_at: 'updated_at',
  is_deleted: 'is_deleted',
  deleted_at: 'deleted_at'
};

exports.Prisma.EventregistrationScalarFieldEnum = {
  event_id: 'event_id',
  user_id: 'user_id',
  registered_at: 'registered_at',
  is_confirmed: 'is_confirmed',
  is_cancelled: 'is_cancelled',
  cancelled_at: 'cancelled_at',
  cancellation_reason: 'cancellation_reason',
  attended: 'attended',
  check_in_time: 'check_in_time',
  dietary_requirements: 'dietary_requirements',
  special_requirements: 'special_requirements',
  id: 'id',
  created_at: 'created_at',
  updated_at: 'updated_at'
};

exports.Prisma.EventsScalarFieldEnum = {
  id: 'id',
  title: 'title',
  date: 'date',
  location: 'location',
  details: 'details',
  link: 'link',
  source: 'source',
  created_at: 'created_at'
};

exports.Prisma.MethodologiesScalarFieldEnum = {
  id: 'id',
  title: 'title',
  published_date: 'published_date',
  abstract: 'abstract',
  description: 'description',
  link: 'link',
  source: 'source',
  permalink: 'permalink',
  created_at: 'created_at',
  report_url: 'report_url'
};

exports.Prisma.Newsletter_logsScalarFieldEnum = {
  id: 'id',
  subscription_id: 'subscription_id',
  sent_at: 'sent_at',
  email_to: 'email_to',
  email_subject: 'email_subject',
  articles_count: 'articles_count',
  success: 'success',
  error_message: 'error_message',
  articles_included: 'articles_included',
  email_content_preview: 'email_content_preview'
};

exports.Prisma.Newsletter_preferencesScalarFieldEnum = {
  id: 'id',
  subscription_id: 'subscription_id',
  sources: 'sources',
  regions: 'regions',
  sectors: 'sectors',
  include_starred_only: 'include_starred_only',
  frequency: 'frequency',
  day_of_week: 'day_of_week',
  time_of_day: 'time_of_day',
  timezone: 'timezone',
  max_articles_per_email: 'max_articles_per_email',
  include_summary: 'include_summary',
  created_at: 'created_at',
  updated_at: 'updated_at'
};

exports.Prisma.Newsletter_subscriptionsScalarFieldEnum = {
  id: 'id',
  user_id: 'user_id',
  subscription_type: 'subscription_type',
  is_active: 'is_active',
  email: 'email',
  created_at: 'created_at',
  updated_at: 'updated_at'
};

exports.Prisma.PermissionScalarFieldEnum = {
  name: 'name',
  description: 'description',
  id: 'id',
  created_at: 'created_at',
  updated_at: 'updated_at'
};

exports.Prisma.PublicationsScalarFieldEnum = {
  id: 'id',
  title: 'title',
  date: 'date',
  description: 'description',
  link: 'link',
  image_url: 'image_url',
  source: 'source',
  created_at: 'created_at'
};

exports.Prisma.RefreshtokenScalarFieldEnum = {
  token: 'token',
  user_id: 'user_id',
  expires_at: 'expires_at',
  revoked: 'revoked',
  revoked_at: 'revoked_at',
  id: 'id',
  created_at: 'created_at',
  updated_at: 'updated_at'
};

exports.Prisma.RolesScalarFieldEnum = {
  id: 'id',
  name: 'name'
};

exports.Prisma.TagScalarFieldEnum = {
  name: 'name',
  slug: 'slug',
  description: 'description',
  id: 'id',
  created_at: 'created_at',
  updated_at: 'updated_at'
};

exports.Prisma.UserScalarFieldEnum = {
  email: 'email',
  username: 'username',
  full_name: 'full_name',
  hashed_password: 'hashed_password',
  is_active: 'is_active',
  is_verified: 'is_verified',
  role: 'role',
  bio: 'bio',
  avatar_url: 'avatar_url',
  phone_number: 'phone_number',
  last_login_at: 'last_login_at',
  last_login_ip: 'last_login_ip',
  failed_login_attempts: 'failed_login_attempts',
  locked_until: 'locked_until',
  two_factor_enabled: 'two_factor_enabled',
  two_factor_secret: 'two_factor_secret',
  email_verified_at: 'email_verified_at',
  email_verification_token: 'email_verification_token',
  password_reset_token: 'password_reset_token',
  password_reset_expires: 'password_reset_expires',
  id: 'id',
  created_at: 'created_at',
  updated_at: 'updated_at',
  is_deleted: 'is_deleted',
  deleted_at: 'deleted_at'
};

exports.Prisma.User_activityScalarFieldEnum = {
  id: 'id',
  user_id: 'user_id',
  action: 'action',
  resource_type: 'resource_type',
  resource_id: 'resource_id',
  details: 'details',
  ip_address: 'ip_address',
  user_agent: 'user_agent',
  timestamp: 'timestamp',
  created_at: 'created_at'
};

exports.Prisma.User_alertsScalarFieldEnum = {
  id: 'id',
  email: 'email',
  sources: 'sources',
  sectors: 'sectors',
  created_at: 'created_at'
};

exports.Prisma.User_article_starsScalarFieldEnum = {
  id: 'id',
  user_id: 'user_id',
  article_id: 'article_id',
  starred_at: 'starred_at'
};

exports.Prisma.User_eventsScalarFieldEnum = {
  id: 'id',
  user_email: 'user_email',
  event_id: 'event_id',
  event_title: 'event_title',
  event_date: 'event_date',
  event_link: 'event_link',
  created_at: 'created_at'
};

exports.Prisma.User_permissionsScalarFieldEnum = {
  user_id: 'user_id',
  permission_id: 'permission_id'
};

exports.Prisma.UsersScalarFieldEnum = {
  id: 'id',
  first_name: 'first_name',
  last_name: 'last_name',
  email: 'email',
  password_hash: 'password_hash',
  role: 'role',
  is_active: 'is_active',
  created_at: 'created_at',
  updated_at: 'updated_at'
};

exports.Prisma.UsersessionScalarFieldEnum = {
  user_id: 'user_id',
  session_id: 'session_id',
  ip_address: 'ip_address',
  user_agent: 'user_agent',
  last_activity: 'last_activity',
  expires_at: 'expires_at',
  id: 'id',
  created_at: 'created_at',
  updated_at: 'updated_at'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.JsonNullValueInput = {
  JsonNull: Prisma.JsonNull
};

exports.Prisma.NullableJsonNullValueInput = {
  DbNull: Prisma.DbNull,
  JsonNull: Prisma.JsonNull
};

exports.Prisma.QueryMode = {
  default: 'default',
  insensitive: 'insensitive'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};

exports.Prisma.JsonNullValueFilter = {
  DbNull: Prisma.DbNull,
  JsonNull: Prisma.JsonNull,
  AnyNull: Prisma.AnyNull
};
exports.permissiontype = exports.$Enums.permissiontype = {
  USER_CREATE: 'USER_CREATE',
  USER_READ: 'USER_READ',
  USER_UPDATE: 'USER_UPDATE',
  USER_DELETE: 'USER_DELETE',
  ARTICLE_CREATE: 'ARTICLE_CREATE',
  ARTICLE_READ: 'ARTICLE_READ',
  ARTICLE_UPDATE: 'ARTICLE_UPDATE',
  ARTICLE_DELETE: 'ARTICLE_DELETE',
  ARTICLE_PUBLISH: 'ARTICLE_PUBLISH',
  EVENT_CREATE: 'EVENT_CREATE',
  EVENT_READ: 'EVENT_READ',
  EVENT_UPDATE: 'EVENT_UPDATE',
  EVENT_DELETE: 'EVENT_DELETE',
  ADMIN_ACCESS: 'ADMIN_ACCESS',
  ADMIN_USERS: 'ADMIN_USERS',
  ADMIN_CONTENT: 'ADMIN_CONTENT',
  ADMIN_SETTINGS: 'ADMIN_SETTINGS',
  ADMIN_LOGS: 'ADMIN_LOGS',
  SYSTEM_CONFIG: 'SYSTEM_CONFIG',
  SYSTEM_BACKUP: 'SYSTEM_BACKUP',
  SYSTEM_MAINTENANCE: 'SYSTEM_MAINTENANCE'
};

exports.userrole = exports.$Enums.userrole = {
  ADMIN: 'ADMIN',
  MODERATOR: 'MODERATOR',
  USER: 'USER',
  GUEST: 'GUEST'
};

exports.Prisma.ModelName = {
  activity_logs: 'activity_logs',
  activitylog: 'activitylog',
  ai_assistant_config: 'ai_assistant_config',
  ai_conversations: 'ai_conversations',
  ai_entity_memory: 'ai_entity_memory',
  ai_knowledge_base: 'ai_knowledge_base',
  ai_session_memory: 'ai_session_memory',
  article: 'article',
  article_tags: 'article_tags',
  articlestar: 'articlestar',
  articleview: 'articleview',
  credit_articles: 'credit_articles',
  email_alerts: 'email_alerts',
  event: 'event',
  eventregistration: 'eventregistration',
  events: 'events',
  methodologies: 'methodologies',
  newsletter_logs: 'newsletter_logs',
  newsletter_preferences: 'newsletter_preferences',
  newsletter_subscriptions: 'newsletter_subscriptions',
  permission: 'permission',
  publications: 'publications',
  refreshtoken: 'refreshtoken',
  roles: 'roles',
  tag: 'tag',
  user: 'user',
  user_activity: 'user_activity',
  user_alerts: 'user_alerts',
  user_article_stars: 'user_article_stars',
  user_events: 'user_events',
  user_permissions: 'user_permissions',
  users: 'users',
  usersession: 'usersession'
};

/**
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)
