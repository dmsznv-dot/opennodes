export interface EvaluationScope {
  $trigger?: unknown;
  trigger?: unknown;
  $nodes?: Record<string, { input?: unknown; output?: unknown }>;
  steps?: Record<string, { input?: unknown; output?: unknown }>;
  nodes?: Record<string, { input?: unknown; output?: unknown }>;
  $env?: Record<string, string>;
  env?: Record<string, string>;
  $item?: unknown;
  item?: unknown;
  $index?: number;
  index?: number;
  [key: string]: unknown;
}

export type ASTNodeType =
  | 'Literal'
  | 'Identifier'
  | 'MemberExpression'
  | 'CallExpression'
  | 'UnaryExpression'
  | 'BinaryExpression'
  | 'LogicalExpression'
  | 'ConditionalExpression'
  | 'ArrayExpression';

export interface ASTBaseNode {
  type: ASTNodeType;
}

export interface LiteralNode extends ASTBaseNode {
  type: 'Literal';
  value: string | number | boolean | null | undefined;
  raw: string;
}

export interface IdentifierNode extends ASTBaseNode {
  type: 'Identifier';
  name: string;
}

export interface MemberExpressionNode extends ASTBaseNode {
  type: 'MemberExpression';
  object: ASTNode;
  property: ASTNode;
  computed: boolean; // true for a[b], false for a.b
  optional: boolean; // true for a?.b
}

export interface CallExpressionNode extends ASTBaseNode {
  type: 'CallExpression';
  callee: MemberExpressionNode | IdentifierNode;
  arguments: ASTNode[];
}

export interface UnaryExpressionNode extends ASTBaseNode {
  type: 'UnaryExpression';
  operator: '!' | '-' | '+';
  argument: ASTNode;
}

export interface BinaryExpressionNode extends ASTBaseNode {
  type: 'BinaryExpression';
  operator: '+' | '-' | '*' | '/' | '%' | '===' | '!==' | '==' | '!=' | '<' | '<=' | '>' | '>=';
  left: ASTNode;
  right: ASTNode;
}

export interface LogicalExpressionNode extends ASTBaseNode {
  type: 'LogicalExpression';
  operator: '&&' | '||' | '??';
  left: ASTNode;
  right: ASTNode;
}

export interface ConditionalExpressionNode extends ASTBaseNode {
  type: 'ConditionalExpression';
  test: ASTNode;
  consequent: ASTNode;
  alternate: ASTNode;
}

export interface ArrayExpressionNode extends ASTBaseNode {
  type: 'ArrayExpression';
  elements: ASTNode[];
}

export type ASTNode =
  | LiteralNode
  | IdentifierNode
  | MemberExpressionNode
  | CallExpressionNode
  | UnaryExpressionNode
  | BinaryExpressionNode
  | LogicalExpressionNode
  | ConditionalExpressionNode
  | ArrayExpressionNode;

export interface IExpressionEvaluator {
  evaluate(expression: string, scope: EvaluationScope): unknown;
  evaluateObject<T>(target: T, scope: EvaluationScope): T;
  parse(expressionString: string): ASTNode;
}
