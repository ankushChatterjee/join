import { useState, useEffect, useRef } from "react";
import { X, Database, Loader2, CheckCircle2, AlertCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import type { DatabaseType, NewConnectionRequest } from "@/stores/types";

const DB_TYPES: { value: DatabaseType; label: string; icon: string }[] = [
  { value: "postgresql", label: "PostgreSQL", icon: "🐘" },
  { value: "mysql", label: "MySQL", icon: "🐬" },
  { value: "sqlite", label: "SQLite", icon: "📦" },
];

const DEFAULT_PORTS: Record<DatabaseType, number> = {
  postgresql: 5432,
  mysql: 3306,
  sqlite: 0,
};

const SSL_MODES = [
  { value: "disable", label: "Disable" },
  { value: "prefer", label: "Prefer (default)" },
  { value: "require", label: "Require" },
];

export function ConnectionDialog() {
  const {
    isConnectionDialogOpen,
    editingConnection,
    closeConnectionDialog,
    addConnection,
    updateConnection,
    testConnection,
  } = useAppStore();

  const [name, setName] = useState("");
  const [dbType, setDbType] = useState<DatabaseType>("postgresql");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("5432");
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sslMode, setSslMode] = useState("prefer");

  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Ref to track if test was cancelled (since we can't abort the backend call)
  const testCancelledRef = useRef(false);

  const isEditing = !!editingConnection;
  const isSqlite = dbType === "sqlite";

  useEffect(() => {
    if (editingConnection) {
      setName(editingConnection.name);
      setDbType(editingConnection.db_type);
      setHost(editingConnection.host ?? "localhost");
      setPort(String(editingConnection.port ?? DEFAULT_PORTS[editingConnection.db_type]));
      setDatabase(editingConnection.database);
      setUsername(editingConnection.username ?? "");
      setPassword(""); // Never pre-fill password
      setSslMode(editingConnection.ssl_mode ?? "prefer");
    } else {
      // Reset to defaults
      setName("");
      setDbType("postgresql");
      setHost("localhost");
      setPort("5432");
      setDatabase("");
      setUsername("");
      setPassword("");
      setSslMode("prefer");
    }
    setTestResult(null);
    setError(null);
  }, [editingConnection, isConnectionDialogOpen]);

  useEffect(() => {
    // Update port when db type changes
    if (!isEditing) {
      setPort(String(DEFAULT_PORTS[dbType]));
    }
  }, [dbType, isEditing]);

  if (!isConnectionDialogOpen) return null;

  const buildRequest = (): NewConnectionRequest => ({
    name,
    db_type: dbType,
    host: isSqlite ? null : host,
    port: isSqlite ? null : parseInt(port, 10),
    database,
    username: isSqlite ? null : username,
    password: isSqlite ? null : password || null,
    ssl_mode: isSqlite ? null : sslMode,
  });

  const handleTest = async () => {
    testCancelledRef.current = false;
    setIsTesting(true);
    setTestResult(null);
    setError(null);

    try {
      await testConnection(buildRequest());
      // Only update state if not cancelled
      if (!testCancelledRef.current) {
        setTestResult("success");
      }
    } catch (err) {
      // Only update state if not cancelled
      if (!testCancelledRef.current) {
        setTestResult("error");
        setError(err as string);
      }
    } finally {
      if (!testCancelledRef.current) {
        setIsTesting(false);
      }
    }
  };

  const handleCancelTest = () => {
    testCancelledRef.current = true;
    setIsTesting(false);
    setTestResult(null);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const request = buildRequest();
      if (isEditing && editingConnection) {
        await updateConnection(editingConnection.id, request);
      } else {
        await addConnection(request);
      }
      closeConnectionDialog();
    } catch (err) {
      setError(err as string);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closeConnectionDialog}
      />

      {/* Dialog */}
      <div className="relative bg-base-900 border border-base-700 rounded-lg shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-base-800">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-accent-500" />
            <h2 className="text-lg font-semibold text-base-50">
              {isEditing ? "Edit Connection" : "New Connection"}
            </h2>
          </div>
          <button
            onClick={closeConnectionDialog}
            className="p-1 rounded hover:bg-base-800 text-base-400 hover:text-base-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Connection Name */}
          <div>
            <label className="block text-sm font-medium text-base-300 mb-1.5">
              Connection Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Database"
              required
              autoCapitalize="off"
              className="w-full h-9 px-3 rounded bg-base-800 border border-base-700 text-base-100 placeholder-base-500 focus:border-accent-500 focus:outline-none transition-colors"
            />
          </div>

          {/* Database Type */}
          <div>
            <label className="block text-sm font-medium text-base-300 mb-1.5">
              Database Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              {DB_TYPES.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  onClick={() => setDbType(type.value)}
                  className={cn(
                    "h-10 px-3 flex items-center justify-center gap-2 rounded border text-sm font-medium transition-all cursor-pointer",
                    dbType === type.value
                      ? "bg-accent-500/10 border-accent-500 text-accent-400"
                      : "bg-base-800 border-base-700 text-base-300 hover:border-base-600"
                  )}
                >
                  <span>{type.icon}</span>
                  <span>{type.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Host & Port (not for SQLite) */}
          {!isSqlite && (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-base-300 mb-1.5">
                  Host
                </label>
                <input
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="localhost"
                  required
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full h-9 px-3 rounded bg-base-800 border border-base-700 text-base-100 placeholder-base-500 focus:border-accent-500 focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-base-300 mb-1.5">
                  Port
                </label>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  required
                  className="w-full h-9 px-3 rounded bg-base-800 border border-base-700 text-base-100 placeholder-base-500 focus:border-accent-500 focus:outline-none transition-colors"
                />
              </div>
            </div>
          )}

          {/* Database / File Path */}
          <div>
            <label className="block text-sm font-medium text-base-300 mb-1.5">
              {isSqlite ? "Database File Path" : "Database Name"}
            </label>
            <input
              type="text"
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
              placeholder={isSqlite ? "/path/to/database.db" : "mydb"}
              required
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full h-9 px-3 rounded bg-base-800 border border-base-700 text-base-100 placeholder-base-500 focus:border-accent-500 focus:outline-none transition-colors"
            />
          </div>

          {/* Username & Password (not for SQLite) */}
          {!isSqlite && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-base-300 mb-1.5">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="postgres"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full h-9 px-3 rounded bg-base-800 border border-base-700 text-base-100 placeholder-base-500 focus:border-accent-500 focus:outline-none transition-colors"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-base-300 mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-9 px-3 rounded bg-base-800 border border-base-700 text-base-100 placeholder-base-500 focus:border-accent-500 focus:outline-none transition-colors"
                />
              </div>
            </div>
          )}

          {/* SSL Mode (not for SQLite) */}
          {!isSqlite && (
            <div>
              <label className="block text-sm font-medium text-base-300 mb-1.5">
                SSL Mode
              </label>
              <select
                value={sslMode}
                onChange={(e) => setSslMode(e.target.value)}
                className="w-full h-9 px-3 rounded bg-base-800 border border-base-700 text-base-100 focus:border-accent-500 focus:outline-none transition-colors cursor-pointer"
              >
                {SSL_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Test result */}
          {testResult === "success" && (
            <div className="p-3 rounded bg-green-500/10 border border-green-500/30 text-green-400 text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Connection successful!
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={isTesting ? handleCancelTest : handleTest}
              disabled={!isTesting && !database}
              className={cn(
                "h-9 px-4 flex items-center gap-2 rounded border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
                isTesting
                  ? "bg-red-500/10 border-red-500/50 text-red-400 hover:bg-red-500/20 hover:border-red-500"
                  : "bg-base-800 border-base-700 text-base-300 hover:text-base-100 hover:border-base-600"
              )}
            >
              {isTesting ? (
                <>
                  <XCircle className="w-4 h-4" />
                  Cancel
                </>
              ) : testResult === "error" ? (
                <>
                  <AlertCircle className="w-4 h-4 text-red-400" />
                  Test
                </>
              ) : (
                <>
                  <Database className="w-4 h-4" />
                  Test
                </>
              )}
            </button>
            <button
              type="button"
              onClick={closeConnectionDialog}
              className="h-9 px-4 rounded bg-base-800 border border-base-700 text-base-300 hover:text-base-100 hover:border-base-600 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !name || !database}
              className="h-9 px-4 flex items-center gap-2 rounded bg-accent-500 text-base-950 font-medium hover:bg-accent-400 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              {isEditing ? "Save" : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
