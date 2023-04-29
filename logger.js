const sqlite3db  = require('better-sqlite3');
const date = require('date-and-time');

const format = (level, message) => `${level.toUpperCase()}: ${message}\n`;
const stdErr = (msg) => process.stderr.write(msg);
const stdOut = (msg) => process.stdout.write(msg);

const DEBUG = 7;
const INFO = 6;
const WARN = 4;
const ERROR = 3;

class Logger {
  constructor(sqlDb, pkgName, logName, logFile, logLevel) {
    this.dbh = null;
    this.sqlFile = sqlDb;
    this.logLevel = logLevel;
    this.params = {
      package: pkgName,
      name: logName,
      filename: logFile,
      logstart: null,
      logend: null,
      lastmodified: null,
      logkey: null
    };
    this.initLog();
    this.params.logkey = this.getLogKey();
    if (this.logLevel >= INFO) stdOut(format('INFO', 'Start logger'));
    this.startLog();
  }

  initLog(clear=false) {
    if (this.dbh) return; // already initialized, so we can return

    this.dbh = new sqlite3db(this.sqlFile);
    this.dbh.pragma('journal_mode = WAL');

    if (clear) {
      const dropTable = this.dbh.prepare('DROP TABLE logs;');
      dropTable.run();
    }

    const createTable = this.dbh.prepare(`
      CREATE TABLE IF NOT EXISTS logs (
      PACKAGE VARCHAR(255) NOT NULL,
      NAME VARCHAR(255) NOT NULL,
      FILENAME VARCHAR (2048) NOT NULL,
      LOGSTART DATETIME,
      LOGEND DATETIME,
      LASTMODIFIED DATETIME NOT NULL,
      LOGKEY INTEGER PRIMARY KEY
      );`);

    const createLogsAttrTable = this.dbh.prepare(`
      CREATE TABLE IF NOT EXISTS logs_attr (
      keyref INTEGER NOT NULL,
      attrib VARCHAR(255) NOT NULL,
      value VARCHAR(255),
      PRIMARY KEY ( keyref, attrib )
      );`);

    createTable.run();
    createLogsAttrTable.run();
  }

  startLog() {
    if (!this.dbh) return; // cannot start without init

    const key = this.getLogSession();
    if (key) return; // already a log entry found, no need to create again

    const insertLogStart = this.dbh.prepare(`
      INSERT INTO logs (
      package, name, filename, logstart, lastmodified) VALUES (
      @package, @name, @filename, @logstart, @lastmodified );`);

    const resp = insertLogStart.run(
      { package: this.params.package,
        name: this.params.name,
        filename: this.params.filename,
        logstart: this.getDateTime(),
        lastmodified: this.getDateTime()
      }
    );

    if (resp && resp.lastInsertRowid) {
      this.params.logkey = resp.lastInsertRowid;
    }

    this.setSessionTitle(this.params.name + ' started');
  }

  getSessionByKey() {
    if (!this.dbh) return; // cannot start without init
    const selectFromLog = this.dbh.prepare('SELECT PACKAGE, NAME, FILENAME, LOGSTART, LOGEND FROM logs WHERE LOGKEY = ? LIMIT 1;');
    const resp = selectFromLog.get(this.params.logkey);
    if (resp && resp.LOGKEY) {
      return resp.LOGKEY;
    } else {
      return null;
    }
  }

  endLog() {
    if (!this.dbh) return; // cannot end without init and log started
    const updateLogEnd = this.dbh.prepare('UPDATE logs set LOGEND = @logend, LASTMODIFIED = @lastmodified WHERE LOGKEY = @logkey;');
    const resp = updateLogEnd.run(
      { logend: this.getDateTime(),
        lastmodified: this.getDateTime(),
        logkey: this.params.logkey
      }
    );
  }

  getLogSession() {
    if (!this.dbh) return; // cannot start without init
    const selectLogSession = this.dbh.prepare('SELECT PACKAGE, NAME, FILENAME, LOGSTART, LOGEND FROM logs WHERE LOGKEY = ? LIMIT 1;');
    const resp = selectLogSession.get(this.params.logkey);
    if ((resp === undefined) || (resp && (resp.LOGEND != null) )) {
      return null; // logkey not found or log already ended
    }
    return this.params.logkey;
  }

  getLogKey() {
    if (!this.dbh) return; // cannot start without init
    const selectLogkey = this.dbh.prepare('SELECT LOGKEY FROM logs WHERE FILENAME LIKE ? ORDER BY LOGSTART DESC LIMIT 1;');
    const resp = selectLogkey.get(this.params.filename);

    if (resp && resp.LOGKEY) {
      return resp.LOGKEY;
    } else {
      return null;
    }
  }

  getDateTime() {
    const now  =  new Date();
    return date.format(now, 'YYYY-MM-DD HH:mm:ss');
  }

  setSessionTitle(title) {
    if (!this.dbh) return; // cannot start without init
    const logAttrTitle = this.dbh.prepare("INSERT OR REPLACE INTO logs_attr (keyref, attrib, value) VALUES (@keyref, @attrib, @value);");
    const resp = logAttrTitle.run(
      {
        value: title,
        attrib: 'LOGSTARTMESSAGE',
        keyref: this.params.logkey
      }
    );
    return title;
  }

  closeLog() {
    if (this.logLevel >= INFO) stdOut(format('INFO', 'Close Logger'));
    this.endLog();
    if (this.dbh) {
      this.dbh.close();
    }
  }

  info(message) {
    if (this.logLevel >= INFO) stdOut(format('INFO', message));
  }

  debug(message) {
    if (this.logLevel === DEBUG) stdOut(format('DEBUG', message));
  }

  warn(message) {
    if (this.logLevel >= WARN) stdOut(format('WARN', message));
  }

  error(message, error) {
    if (this.logLevel >= ERROR) {
      stdErr(format('ERROR', message));

      if (error) {
        if (error.stack) {
          return stdErr(`    ${error.stack}\n`);
        }
        return stdErr(`    ${error.name}: ${error.message}\n`);
      }
    }
  }
}

module.exports = Logger;
