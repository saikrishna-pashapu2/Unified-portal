
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

exports.Prisma.Alembic_versionScalarFieldEnum = {
  version_num: 'version_num'
};

exports.Prisma.Esg_articlesScalarFieldEnum = {
  id: 'id',
  title: 'title',
  published: 'published',
  summary: 'summary',
  link: 'link',
  source: 'source',
  matched_keywords: 'matched_keywords',
  save_time: 'save_time'
};

exports.Prisma.EventsScalarFieldEnum = {
  id: 'id',
  event_name: 'event_name',
  event_id: 'event_id',
  event_url: 'event_url',
  start_date: 'start_date',
  end_date: 'end_date',
  start_time: 'start_time',
  end_time: 'end_time',
  timezone: 'timezone',
  image_url: 'image_url',
  ticket_price: 'ticket_price',
  tickets_url: 'tickets_url',
  venue_name: 'venue_name',
  venue_address: 'venue_address',
  organizer_name: 'organizer_name',
  organizer_url: 'organizer_url',
  summary: 'summary',
  tags: 'tags',
  source: 'source',
  month: 'month',
  created_at: 'created_at'
};

exports.Prisma.File_uploadsScalarFieldEnum = {
  id: 'id',
  task_id: 'task_id',
  original_filename: 'original_filename',
  stored_filename: 'stored_filename',
  output_filename: 'output_filename',
  status: 'status',
  error_message: 'error_message',
  user_id: 'user_id',
  created_at: 'created_at',
  updated_at: 'updated_at'
};

exports.Prisma.LikesScalarFieldEnum = {
  id: 'id',
  user_id: 'user_id',
  content_type: 'content_type',
  content_id: 'content_id',
  created_at: 'created_at'
};

exports.Prisma.Pdf_translation_jobsScalarFieldEnum = {
  id: 'id',
  user_id: 'user_id',
  filename: 'filename',
  stored_filename: 'stored_filename',
  input_path: 'input_path',
  target_lang: 'target_lang',
  status: 'status',
  message: 'message',
  progress: 'progress',
  total_pages: 'total_pages',
  current_page: 'current_page',
  pages: 'pages',
  translated_pages: 'translated_pages',
  output_path: 'output_path',
  output_pdf: 'output_pdf',
  created_at: 'created_at',
  updated_at: 'updated_at',
  completed_at: 'completed_at'
};

exports.Prisma.Pdf_translationsScalarFieldEnum = {
  id: 'id',
  job_id: 'job_id',
  user_id: 'user_id',
  original_filename: 'original_filename',
  file_path: 'file_path',
  file_size: 'file_size',
  source_language: 'source_language',
  target_language: 'target_language',
  total_pages: 'total_pages',
  total_words: 'total_words',
  status: 'status',
  created_at: 'created_at',
  started_at: 'started_at',
  completed_at: 'completed_at',
  processing_time: 'processing_time',
  success_pages: 'success_pages',
  failed_pages: 'failed_pages',
  error_message: 'error_message',
  ocr_method: 'ocr_method'
};

exports.Prisma.PublicationsScalarFieldEnum = {
  id: 'id',
  title: 'title',
  published: 'published',
  summary: 'summary',
  link: 'link',
  source: 'source',
  image_url: 'image_url',
  save_time: 'save_time'
};

exports.Prisma.Translation_historyScalarFieldEnum = {
  id: 'id',
  user_id: 'user_id',
  total_translations: 'total_translations',
  total_pages_processed: 'total_pages_processed',
  total_words_translated: 'total_words_translated',
  total_processing_time: 'total_processing_time',
  most_used_source_lang: 'most_used_source_lang',
  most_used_target_lang: 'most_used_target_lang',
  first_translation: 'first_translation',
  last_translation: 'last_translation',
  last_updated: 'last_updated'
};

exports.Prisma.Translation_pagesScalarFieldEnum = {
  id: 'id',
  translation_id: 'translation_id',
  page_number: 'page_number',
  original_text: 'original_text',
  translated_text: 'translated_text',
  original_word_count: 'original_word_count',
  translated_word_count: 'translated_word_count',
  extraction_method: 'extraction_method',
  processing_time: 'processing_time',
  status: 'status',
  error_message: 'error_message',
  created_at: 'created_at'
};

exports.Prisma.User_preferencesScalarFieldEnum = {
  id: 'id',
  user_id: 'user_id',
  preferred_sources: 'preferred_sources',
  preferred_topics: 'preferred_topics'
};

exports.Prisma.UsersScalarFieldEnum = {
  id: 'id',
  username: 'username',
  email: 'email',
  password: 'password',
  password_hash: 'password_hash',
  first_name: 'first_name',
  last_name: 'last_name',
  is_admin: 'is_admin',
  created_at: 'created_at',
  last_login: 'last_login',
  preferred_categories: 'preferred_categories',
  email_notifications: 'email_notifications',
  is_active_db: 'is_active_db',
  team: 'team'
};

exports.Prisma.Alert_preferencesScalarFieldEnum = {
  id: 'id',
  user_id: 'user_id',
  domain: 'domain',
  weekly_digest: 'weekly_digest',
  daily_digest: 'daily_digest',
  immediate_alerts: 'immediate_alerts',
  alert_articles: 'alert_articles',
  alert_events: 'alert_events',
  alert_publications: 'alert_publications',
  sources: 'sources',
  keywords: 'keywords',
  team_likes_only: 'team_likes_only',
  email_enabled: 'email_enabled',
  email_address: 'email_address',
  digest_day: 'digest_day',
  digest_hour: 'digest_hour',
  timezone: 'timezone',
  created_at: 'created_at',
  updated_at: 'updated_at',
  alert_name: 'alert_name',
  alert_type: 'alert_type',
  is_active: 'is_active',
  immediate_sources: 'immediate_sources',
  immediate_keywords: 'immediate_keywords',
  immediate_content_types: 'immediate_content_types',
  last_sent_at: 'last_sent_at',
  next_send_at: 'next_send_at',
  domains: 'domains'
};

exports.Prisma.Alert_historyScalarFieldEnum = {
  id: 'id',
  user_id: 'user_id',
  domain: 'domain',
  alert_type: 'alert_type',
  content_type: 'content_type',
  content_ids: 'content_ids',
  email_to: 'email_to',
  email_subject: 'email_subject',
  email_status: 'email_status',
  total_items: 'total_items',
  opened_at: 'opened_at',
  clicked_at: 'clicked_at',
  error_message: 'error_message',
  retry_count: 'retry_count',
  sent_at: 'sent_at',
  created_at: 'created_at',
  template_version: 'template_version',
  job_id: 'job_id'
};

exports.Prisma.Email_queueScalarFieldEnum = {
  id: 'id',
  user_id: 'user_id',
  email_to: 'email_to',
  email_subject: 'email_subject',
  email_body: 'email_body',
  email_html: 'email_html',
  priority: 'priority',
  scheduled_for: 'scheduled_for',
  status: 'status',
  attempts: 'attempts',
  max_attempts: 'max_attempts',
  last_error: 'last_error',
  last_attempt_at: 'last_attempt_at',
  sent_at: 'sent_at',
  processed_by: 'processed_by',
  created_at: 'created_at',
  updated_at: 'updated_at',
  alert_type: 'alert_type',
  domain: 'domain',
  metadata: 'metadata'
};

exports.Prisma.Alert_content_sentScalarFieldEnum = {
  id: 'id',
  alert_preference_id: 'alert_preference_id',
  domain: 'domain',
  content_type: 'content_type',
  content_id: 'content_id',
  content_save_time: 'content_save_time',
  sent_at: 'sent_at'
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


exports.Prisma.ModelName = {
  alembic_version: 'alembic_version',
  esg_articles: 'esg_articles',
  events: 'events',
  file_uploads: 'file_uploads',
  likes: 'likes',
  pdf_translation_jobs: 'pdf_translation_jobs',
  pdf_translations: 'pdf_translations',
  publications: 'publications',
  translation_history: 'translation_history',
  translation_pages: 'translation_pages',
  user_preferences: 'user_preferences',
  users: 'users',
  alert_preferences: 'alert_preferences',
  alert_history: 'alert_history',
  email_queue: 'email_queue',
  alert_content_sent: 'alert_content_sent'
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
