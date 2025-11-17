import { X } from 'lucide-react';

interface GeneratedQuery {
  sql: string;
  params: Record<string, string | number>;
  description: string;
}

interface QueryDisplayProps {
  queries: GeneratedQuery[];
  onClose: () => void;
}

export function QueryDisplay({ queries, onClose }: QueryDisplayProps) {
  if (queries.length === 0) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Generated ClickHouse Queries
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              {queries.length} {queries.length === 1 ? 'query' : 'queries'} generated (not executed)
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {queries.map((query, index) => (
            <div
              key={index}
              className="bg-gray-50 rounded-lg border border-gray-200 overflow-hidden"
            >
              {/* Query Header */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-2 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Query {index + 1} of {queries.length}
                  </h3>
                  <span className="text-xs text-gray-500 font-mono">
                    {query.description}
                  </span>
                </div>
              </div>

              {/* SQL Code */}
              <div className="p-4">
                <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
                  <pre className="text-sm text-green-400 font-mono whitespace-pre">
                    {query.sql}
                  </pre>
                </div>

                {/* Parameters */}
                {Object.keys(query.params).length > 0 && (
                  <div className="mt-3">
                    <h4 className="text-xs font-semibold text-gray-700 mb-2">
                      Parameters:
                    </h4>
                    <div className="bg-white rounded border border-gray-200 divide-y divide-gray-200">
                      {Object.entries(query.params).map(([key, value]) => (
                        <div
                          key={key}
                          className="flex items-center justify-between px-3 py-2"
                        >
                          <span className="text-xs font-mono text-gray-600">
                            {key}
                          </span>
                          <span className="text-xs font-mono text-blue-600">
                            {typeof value === 'string' ? `'${value}'` : value}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-4 py-3 bg-gray-50">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-600">
              These queries are generated but not executed. They show what would be sent to ClickHouse.
            </p>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
