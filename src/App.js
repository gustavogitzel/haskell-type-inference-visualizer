import React, { useState } from 'react';
import { Play, Terminal, GitBranch, Check, AlertTriangle, Code } from 'lucide-react';

// --- 1. TYPE SYSTEM DEFINITIONS ---

class Type {
    constructor(id) { this.id = id; }
    toString() { return this.id; }
}
class TypeInt extends Type { constructor() { super("Int"); } }
class TypeBool extends Type { constructor() { super("Bool"); } }
class TypeVar extends Type {
    constructor(name) { super(name); this.name = name; this.instance = null; }
    toString() { return this.instance ? this.instance.toString() : this.name; }
}
class TypeArrow extends Type {
    constructor(param, ret) { super("Arrow"); this.param = param; this.ret = ret; }
    toString() {
        const p = this.param instanceof TypeArrow ? `(${this.param})` : this.param;
        return `${p} -> ${this.ret}`;
    }
}

// --- 2. AST DEFINITIONS ---

class Expr {}
class EInt extends Expr { constructor(val) { super(); this.val = val; } }
class EBool extends Expr { constructor(val) { super(); this.val = val; } }
class EVar extends Expr { constructor(name) { super(); this.name = name; } }
class EBinOp extends Expr { constructor(op, left, right) { super(); this.op = op; this.left = left; this.right = right; } }
class EIf extends Expr { constructor(cond, thenBr, elseBr) { super(); this.cond = cond; this.thenBr = thenBr; this.elseBr = elseBr; } }
class EFun extends Expr { constructor(param, body) { super(); this.param = param; this.body = body; } }
class ELet extends Expr { constructor(name, val, body) { super(); this.name = name; this.val = val; this.body = body; } }
class EApp extends Expr { constructor(func, arg) { super(); this.func = func; this.arg = arg; } }

// --- 3. PARSER (Text -> AST) ---

const tokenize = (input) => {
    // Simple regex for tokens: numbers, booleans, keywords, arrows, operators, ids, parens
    const regex = /\s+|(\d+)|(true|false)|(let|in|if|then|else|fun)|(->)|(==|!=|<=|>=|<|>|\+|-|\*|\/|=)|([a-zA-Z_][a-zA-Z0-9_]*)|(\(|\))/g;
    const tokens = [];
    let match;
    while ((match = regex.exec(input)) !== null) {
        if (match[0].trim().length === 0) continue;
        if (match[1]) tokens.push({ type: 'NUM', val: parseInt(match[1]) });
        else if (match[2]) tokens.push({ type: 'BOOL', val: match[2] === 'true' });
        else if (match[3]) tokens.push({ type: 'KW', val: match[3] });
        else if (match[4]) tokens.push({ type: 'ARROW', val: '->' });
        else if (match[5]) tokens.push({ type: 'OP', val: match[5] });
        else if (match[6]) tokens.push({ type: 'ID', val: match[6] });
        else if (match[7]) tokens.push({ type: 'PUNC', val: match[7] });
    }
    return tokens;
};

class Parser {
    constructor(tokens) { this.tokens = tokens; this.pos = 0; }
    peek() { return this.tokens[this.pos]; }
    consume() { return this.tokens[this.pos++]; }
    match(type, val) {
        const t = this.peek();
        if (t && t.type === type && (!val || t.val === val)) {
            this.consume();
            return true;
        }
        return false;
    }
    expect(type, val) {
        if (!this.match(type, val)) throw new Error(`Syntax Error: Expected ${val || type}, found ${this.peek()?.val}`);
    }

    parseAtom() {
        const t = this.peek();
        if (!t) throw new Error("Unexpected End of File");
        if (t.type === 'NUM') { this.consume(); return new EInt(t.val); }
        if (t.type === 'BOOL') { this.consume(); return new EBool(t.val); }
        if (t.type === 'ID') { this.consume(); return new EVar(t.val); }
        if (this.match('PUNC', '(')) {
            const expr = this.parseExpression();
            this.expect('PUNC', ')');
            return expr;
        }
        throw new Error(`Unexpected Token: ${t.val}`);
    }

    parseApp() {
        let expr = this.parseAtom();
        while (true) {
            const t = this.peek();
            if (t && (t.type === 'NUM' || t.type === 'BOOL' || t.type === 'ID' || (t.type === 'PUNC' && t.val === '('))) {
                const arg = this.parseAtom();
                expr = new EApp(expr, arg);
            } else {
                break;
            }
        }
        return expr;
    }

    parseBinary() {
        let left = this.parseApp();
        const t = this.peek();
        if (t && t.type === 'OP' && t.val !== '=') {
            this.consume();
            const right = this.parseBinary();
            return new EBinOp(t.val, left, right);
        }
        return left;
    }

    parseExpression() {
        if (this.match('KW', 'let')) {
            const tId = this.consume();
            if (tId.type !== 'ID') throw new Error("Expected identifier after 'let'");
            this.expect('OP', '=');
            const val = this.parseExpression();
            this.expect('KW', 'in');
            const body = this.parseExpression();
            return new ELet(tId.val, val, body);
        }
        if (this.match('KW', 'fun')) {
            const tParam = this.consume();
            if (tParam.type !== 'ID') throw new Error("Expected parameter after 'fun'");
            this.expect('ARROW');
            const body = this.parseExpression();
            return new EFun(tParam.val, body);
        }
        if (this.match('KW', 'if')) {
            const cond = this.parseExpression();
            this.expect('KW', 'then');
            const thenBr = this.parseExpression();
            this.expect('KW', 'else');
            const elseBr = this.parseExpression();
            return new EIf(cond, thenBr, elseBr);
        }
        return this.parseBinary();
    }
}

// --- 4. INFERENCE ENGINE ---

let typeVarCounter = 0;
const resetTypeVars = () => { typeVarCounter = 0; };
const newTypeVar = () => new TypeVar(`T${typeVarCounter++}`);
const prune = (t) => { if (t instanceof TypeVar && t.instance) { t.instance = prune(t.instance); return t.instance; } return t; };
const occursIn = (tvar, type) => {
    type = prune(type);
    if (tvar === type) return true;
    if (type instanceof TypeArrow) return occursIn(tvar, type.param) || occursIn(tvar, type.ret);
    return false;
};
const unify = (t1, t2, logger) => {
    t1 = prune(t1); t2 = prune(t2);
    if (t1 === t2) return;
    if (t1 instanceof TypeInt && t2 instanceof TypeInt) return;
    if (t1 instanceof TypeBool && t2 instanceof TypeBool) return;
    if (t1 instanceof TypeVar) {
        if (occursIn(t1, t2)) throw new Error(`Infinite Type Error: ${t1} occurs in ${t2}`);
        t1.instance = t2; logger(`Unify: ${t1.name} ~ ${t2}`, 'success'); return;
    }
    if (t2 instanceof TypeVar) { unify(t2, t1, logger); return; }
    if (t1 instanceof TypeArrow && t2 instanceof TypeArrow) {
        unify(t1.param, t2.param, logger); unify(t1.ret, t2.ret, logger); return;
    }
    throw new Error(`Type Mismatch: Expected ${t1}, Found ${t2}`);
};

const analyze = (env, expr, logger) => {
    if (expr instanceof EInt) { return new TypeInt(); }
    if (expr instanceof EBool) { return new TypeBool(); }
    if (expr instanceof EVar) {
        const t = env[expr.name];
        if (!t) throw new Error(`Undefined Variable: '${expr.name}'`);
        return t;
    }
    if (expr instanceof EBinOp) {
        logger(`Analyzing Binary Op '${expr.op}'`, 'info');
        const tLeft = analyze(env, expr.left, logger);
        const tRight = analyze(env, expr.right, logger);
        if (['+', '-', '*', '/'].includes(expr.op)) {
            unify(tLeft, new TypeInt(), logger); unify(tRight, new TypeInt(), logger); return new TypeInt();
        } else if (['==', '!=', '<', '>'].includes(expr.op)) {
            unify(tLeft, tRight, logger); return new TypeBool();
        }
    }
    if (expr instanceof EIf) {
        const tCond = analyze(env, expr.cond, logger);
        unify(tCond, new TypeBool(), logger);
        const tThen = analyze(env, expr.thenBr, logger);
        const tElse = analyze(env, expr.elseBr, logger);
        unify(tThen, tElse, logger);
        return tThen;
    }
    if (expr instanceof EFun) {
        const paramType = newTypeVar();
        const newEnv = { ...env, [expr.param]: paramType };
        logger(`Function: param '${expr.param}' is ${paramType.name}`, 'info');
        const bodyType = analyze(newEnv, expr.body, logger);
        return new TypeArrow(paramType, bodyType);
    }
    if (expr instanceof EApp) {
        const tFunc = analyze(env, expr.func, logger);
        const tArg = analyze(env, expr.arg, logger);
        const tRet = newTypeVar();
        unify(tFunc, new TypeArrow(tArg, tRet), logger);
        return tRet;
    }
    if (expr instanceof ELet) {
        logger(`Let Binding '${expr.name}'`, 'info');
        const valType = analyze(env, expr.val, logger);
        const newEnv = { ...env, [expr.name]: valType };
        return analyze(newEnv, expr.body, logger);
    }
    throw new Error("Unknown Expression");
};

// --- 5. SCENARIOS (English) ---

const SCENARIOS = [
    {
        id: 'basic',
        title: "1. Simple Integer",
        code: "10 + 5",
        description: "Basic arithmetic operations force operands to be Integer."
    },
    {
        id: 'func',
        title: "2. Simple Function",
        code: "fun x -> x + 1",
        description: "Compiler infers 'x' must be Int because of usage with '+'."
    },
    {
        id: 'poly',
        title: "3. Polymorphism",
        code: "fun x -> x",
        description: "Identity function. 'x' is T0 and returns T0. No constraints found."
    },
    {
        id: 'if',
        title: "4. Conditional",
        code: "fun x -> if x then 1 else 0",
        description: "The 'if' condition forces 'x' to Bool, branches force return to Int."
    },
    {
        id: 'error',
        title: "5. Type Error",
        code: "true + 1",
        description: "Trying to add Bool and Int. Unification should fail."
    },
    {
        id: 'hof',
        title: "6. Higher Order",
        code: "let apply = (fun f -> f 10) in apply (fun x -> x + 1)",
        description: "Passing a function as an argument. Complex inference chain."
    }
];

// --- 6. REACT COMPONENT ---

export default function App() {
    const [code, setCode] = useState(SCENARIOS[0].code);
    const [description, setDescription] = useState(SCENARIOS[0].description);
    const [logs, setLogs] = useState([]);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);

    const loadScenario = (sc) => {
        setCode(sc.code);
        setDescription(sc.description);
        setError(null);
        setResult(null);
        setLogs([]);
    };

    const runInference = () => {
        resetTypeVars();
        setLogs([]);
        setResult(null);
        setError(null);

        const localLogs = [];
        const logger = (msg, type = 'info') => {
            localLogs.push({ msg, type, id: Math.random() });
        };

        try {
            logger("1. Tokenizing input...", 'info');
            const tokens = tokenize(code);

            logger("2. Generating AST (Parser)...", 'info');
            const parser = new Parser(tokens);
            const ast = parser.parseExpression();

            if (parser.peek()) logger("Warning: Unconsumed tokens remaining.", 'warn');

            logger("3. Running Inference Algorithm...", 'info');
            const type = analyze({}, ast, logger);

            const finalType = prune(type).toString();
            setResult(finalType);
            logger(`SUCCESS: Final Inferred Type: ${finalType}`, 'success');

        } catch (e) {
            setError(e.message);
            logger(`ERROR: ${e.message}`, 'error');
        }

        setLogs(localLogs);
    };

    const getLogColor = (type) => {
        switch(type) {
            case 'success': return 'text-green-400';
            case 'error': return 'text-red-400 font-bold';
            case 'warn': return 'text-yellow-400';
            default: return 'text-gray-400';
        }
    };

    return (
        <div className="flex flex-col h-screen bg-slate-900 text-slate-100 p-4 md:p-6 font-mono overflow-hidden">
            <header className="mb-4 border-b border-slate-700 pb-4 flex justify-between items-center">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-blue-400 flex items-center gap-2">
                        <Terminal className="w-6 h-6" />
                        Type Inference Visualizer
                    </h1>
                    <p className="text-slate-400 text-xs mt-1">
                        Edit the code below and watch Algorithm W in action
                    </p>
                </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full min-h-0">

                {/* LEFT COLUMN: Editor & Controls */}
                <div className="lg:col-span-5 flex flex-col gap-4 min-h-0">

                    {/* Scenario Selector */}
                    <div className="bg-slate-800 p-3 rounded-lg border border-slate-700">
                        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <GitBranch className="w-3 h-3" /> Load Example
                        </h2>
                        <div className="flex flex-wrap gap-2">
                            {SCENARIOS.map((sc) => (
                                <button
                                    key={sc.id}
                                    onClick={() => loadScenario(sc)}
                                    className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded transition-colors"
                                >
                                    {sc.title}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Code Editor */}
                    <div className="flex-1 bg-slate-800 p-1 rounded-lg border border-slate-700 flex flex-col shadow-lg relative group">
                        <div className="absolute top-2 right-2 opacity-50 group-hover:opacity-100 transition-opacity">
                            <Code className="w-4 h-4 text-slate-400" />
                        </div>
                        <textarea
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            className="flex-1 w-full bg-slate-900/50 text-blue-100 p-4 font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 rounded"
                            placeholder="Write expression here... ex: fun x -> x + 1"
                            spellCheck="false"
                        />
                        <div className="p-3 bg-slate-800 text-xs text-slate-400 border-t border-slate-700/50">
                            {description}
                        </div>
                    </div>

                    {/* Action Button & Result */}
                    <div className="flex flex-col gap-3">
                        <button
                            onClick={runInference}
                            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-lg font-bold transition-colors shadow-lg active:scale-95 transform duration-100"
                        >
                            <Play className="w-4 h-4" /> Compile & Infer
                        </button>

                        {error ? (
                            <div className="flex items-center gap-3 text-red-200 bg-red-900/40 p-4 rounded border border-red-500/30 shadow-inner">
                                <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0" />
                                <div>
                                    <div className="text-xs font-bold uppercase text-red-400">Type Error</div>
                                    <div className="text-sm font-mono">{error}</div>
                                </div>
                            </div>
                        ) : result ? (
                            <div className="flex items-center gap-3 text-green-200 bg-green-900/40 p-4 rounded border border-green-500/30 shadow-inner">
                                <Check className="w-6 h-6 text-green-400 flex-shrink-0" />
                                <div>
                                    <div className="text-xs font-bold uppercase text-green-400">Inferred Type</div>
                                    <div className="text-lg font-mono font-bold tracking-wide">{result}</div>
                                </div>
                            </div>
                        ) : (
                            <div className="h-20 flex items-center justify-center text-slate-600 text-sm border border-dashed border-slate-700 rounded">
                                Waiting for execution...
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT COLUMN: Logs */}
                <div className="lg:col-span-7 bg-black rounded-lg border border-slate-700 p-4 font-mono text-sm overflow-hidden flex flex-col shadow-2xl relative">
                    <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-800">
                        <h2 className="text-slate-400 text-xs uppercase tracking-widest flex items-center gap-2">
                            <Terminal className="w-3 h-3" /> Inference Log
                        </h2>
                        <span className="text-[10px] text-slate-600 border border-slate-700 px-2 py-0.5 rounded">Verbose: ON</span>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-1.5 pr-2 custom-scrollbar font-mono text-xs md:text-sm">
                        {logs.length === 0 && (
                            <div className="text-slate-700 mt-10 text-center italic">
                                Unification log will appear here...
                            </div>
                        )}
                        {logs.map((log) => (
                            <div key={log.id} className={`flex gap-2 ${getLogColor(log.type)} animate-fadeIn border-l-2 border-transparent hover:border-slate-700 pl-1`}>
                                <span className="opacity-30 select-none flex-shrink-0">{'>'}</span>
                                <span className="break-all">{log.msg}</span>
                            </div>
                        ))}
                    </div>
                </div>

            </div>

            <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #0f172a; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #475569; }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateX(-5px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .animate-fadeIn { animation: fadeIn 0.2s ease-out forwards; }
      `}</style>
        </div>
    );
}