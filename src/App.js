import React, { useState } from 'react';
import { Play, Terminal, GitBranch, Check, AlertTriangle, Code } from 'lucide-react';
import './index.css'; // Garante que os estilos sejam carregados

// --- 1. DEFINIÇÕES DO SISTEMA DE TIPOS ---

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

// --- 2. DEFINIÇÕES DA AST ---

class Expr {}
class EInt extends Expr { constructor(val) { super(); this.val = val; } }
class EBool extends Expr { constructor(val) { super(); this.val = val; } }
class EVar extends Expr { constructor(name) { super(); this.name = name; } }
class EBinOp extends Expr { constructor(op, left, right) { super(); this.op = op; this.left = left; this.right = right; } }
class EIf extends Expr { constructor(cond, thenBr, elseBr) { super(); this.cond = cond; this.thenBr = thenBr; this.elseBr = elseBr; } }
class EFun extends Expr { constructor(param, body) { super(); this.param = param; this.body = body; } }
class ELet extends Expr { constructor(name, val, body) { super(); this.name = name; this.val = val; this.body = body; } }
class EApp extends Expr { constructor(func, arg) { super(); this.func = func; this.arg = arg; } }

// --- 3. PARSER (Texto -> AST) ---

const tokenize = (input) => {
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
        if (!this.match(type, val)) throw new Error(`Erro de Sintaxe: Esperado ${val || type}, encontrado ${this.peek()?.val}`);
    }

    parseAtom() {
        const t = this.peek();
        if (!t) throw new Error("Fim de arquivo inesperado");
        if (t.type === 'NUM') { this.consume(); return new EInt(t.val); }
        if (t.type === 'BOOL') { this.consume(); return new EBool(t.val); }
        if (t.type === 'ID') { this.consume(); return new EVar(t.val); }
        if (this.match('PUNC', '(')) {
            const expr = this.parseExpression();
            this.expect('PUNC', ')');
            return expr;
        }
        throw new Error(`Token inesperado: ${t.val}`);
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
            if (tId.type !== 'ID') throw new Error("Esperado identificador após 'let'");
            this.expect('OP', '=');
            const val = this.parseExpression();
            this.expect('KW', 'in');
            const body = this.parseExpression();
            return new ELet(tId.val, val, body);
        }
        if (this.match('KW', 'fun')) {
            const tParam = this.consume();
            if (tParam.type !== 'ID') throw new Error("Esperado parâmetro após 'fun'");
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

// --- 4. MOTOR DE INFERÊNCIA ---

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
const unify = (t1, t2, logger, contextMsg) => {
    t1 = prune(t1); t2 = prune(t2);
    if (t1 === t2) return;
    if (t1 instanceof TypeInt && t2 instanceof TypeInt) return;
    if (t1 instanceof TypeBool && t2 instanceof TypeBool) return;
    if (t1 instanceof TypeVar) {
        if (occursIn(t1, t2)) throw new Error(`Erro de Tipo Infinito: ${t1} ocorre dentro de ${t2}`);
        t1.instance = t2;
        logger(`UNIFICAR: ${t1.name} agora é ${t2} (${contextMsg || 'Resolução de restrição'})`, 'success');
        return;
    }
    if (t2 instanceof TypeVar) { unify(t2, t1, logger, contextMsg); return; }
    if (t1 instanceof TypeArrow && t2 instanceof TypeArrow) {
        unify(t1.param, t2.param, logger, 'Parâmetros de função devem coincidir');
        unify(t1.ret, t2.ret, logger, 'Retorno de função deve coincidir');
        return;
    }
    throw new Error(`Tipo Incompatível: Esperado ${t1}, Encontrado ${t2}`);
};

const analyze = (env, expr, logger) => {
    if (expr instanceof EInt) { return new TypeInt(); }
    if (expr instanceof EBool) { return new TypeBool(); }
    if (expr instanceof EVar) {
        const t = env[expr.name];
        if (!t) throw new Error(`Variável Indefinida: '${expr.name}'`);
        return t;
    }
    if (expr instanceof EBinOp) {
        logger(`RESTRIÇÃO: Operador '${expr.op}' exige operandos compatíveis.`, 'info');
        const tLeft = analyze(env, expr.left, logger);
        const tRight = analyze(env, expr.right, logger);
        if (['+', '-', '*', '/'].includes(expr.op)) {
            unify(tLeft, new TypeInt(), logger, `Lado esquerdo de '${expr.op}' deve ser Int`);
            unify(tRight, new TypeInt(), logger, `Lado direito de '${expr.op}' deve ser Int`);
            return new TypeInt();
        } else if (['==', '!=', '<', '>'].includes(expr.op)) {
            unify(tLeft, tRight, logger, `Operandos de '${expr.op}' devem ser iguais`);
            return new TypeBool();
        }
    }
    if (expr instanceof EIf) {
        logger(`RESTRIÇÃO: Condição do 'if' deve ser Bool, ramos devem ser iguais.`, 'info');
        const tCond = analyze(env, expr.cond, logger);
        unify(tCond, new TypeBool(), logger, "Condição do 'if'");
        const tThen = analyze(env, expr.thenBr, logger);
        const tElse = analyze(env, expr.elseBr, logger);
        unify(tThen, tElse, logger, "Ramo 'else' deve igualar ramo 'then'");
        return tThen;
    }
    if (expr instanceof EFun) {
        const paramType = newTypeVar();
        const newEnv = { ...env, [expr.param]: paramType };
        logger(`NOVO ESCOPO: Parâmetro '${expr.param}' assumiu tipo novo ${paramType.name}`, 'info');
        const bodyType = analyze(newEnv, expr.body, logger);
        return new TypeArrow(paramType, bodyType);
    }
    if (expr instanceof EApp) {
        const tFunc = analyze(env, expr.func, logger);
        const tArg = analyze(env, expr.arg, logger);
        const tRet = newTypeVar();
        logger(`RESTRIÇÃO: Aplicando função ${tFunc} ao argumento ${tArg}`, 'info');
        unify(tFunc, new TypeArrow(tArg, tRet), logger, "Aplicação de função");
        return tRet;
    }
    if (expr instanceof ELet) {
        logger(`LET: Inferindo tipo para '${expr.name}'...`, 'info');
        const valType = analyze(env, expr.val, logger);
        const newEnv = { ...env, [expr.name]: valType };
        logger(`AMBIENTE: '${expr.name}' definido como ${valType}`, 'info');
        return analyze(newEnv, expr.body, logger);
    }
    throw new Error("Expressão Desconhecida");
};

// --- 5. CENÁRIOS (Em Português) ---

const SCENARIOS = [
    {
        id: 'basic',
        title: "1. Inteiro Simples",
        code: "10 + 5",
        description: "Operações aritméticas básicas forçam os operandos a serem Inteiros."
    },
    {
        id: 'func',
        title: "2. Função Simples",
        code: "fun x -> x + 1",
        description: "O compilador infere que 'x' deve ser Int devido ao uso com '+'."
    },
    {
        id: 'poly',
        title: "3. Polimorfismo",
        code: "fun x -> x",
        description: "Função Identidade. 'x' entra como T0 e sai como T0. Nenhuma restrição encontrada."
    },
    {
        id: 'if',
        title: "4. Condicional",
        code: "fun x -> if x then 1 else 0",
        description: "A condição 'if' força 'x' a ser Bool, os ramos forçam o retorno a ser Int."
    },
    {
        id: 'error',
        title: "5. Erro de Tipo",
        code: "true + 1",
        description: "Tentativa de somar Bool e Int. A unificação deve falhar."
    },
    {
        id: 'hof',
        title: "6. Ordem Superior",
        code: "let apply = (fun f -> f 10) in apply (fun x -> x + 1)",
        description: "Passando uma função como argumento. Cadeia de inferência complexa."
    }
];

// --- 6. COMPONENTE REACT ---

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
            logger("1. Tokenizando entrada...", 'info');
            const tokens = tokenize(code);

            logger("2. Gerando AST (Parser)...", 'info');
            const parser = new Parser(tokens);
            const ast = parser.parseExpression();

            if (parser.peek()) logger("Aviso: Tokens sobrando após análise.", 'warn');

            logger("3. Iniciando Algoritmo W (Inferência)...", 'info');
            const type = analyze({}, ast, logger);

            const finalType = prune(type).toString();
            setResult(finalType);
            logger(`SUCESSO: Tipo Inferido: ${finalType}`, 'success');

        } catch (e) {
            setError(e.message);
            logger(`ERRO: ${e.message}`, 'error');
        }

        setLogs(localLogs);
    };

    const getLogColor = (type) => {
        switch(type) {
            case 'success': return 'text-green-400 font-semibold';
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
                        Visualizador de Inferência de Tipos
                    </h1>
                    <p className="text-slate-400 text-xs mt-1">
                        Demo Interativa do Algoritmo W (Hindley-Milner)
                    </p>
                </div>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full min-h-0">

                {/* LEFT COLUMN: Editor & Controls */}
                <div className="lg:col-span-5 flex flex-col gap-4 min-h-0">

                    {/* Scenario Selector */}
                    <div className="bg-slate-800 p-3 rounded-lg border border-slate-700">
                        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                            <GitBranch className="w-3 h-3" /> Carregar Exemplo
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
                            placeholder="Escreva o código aqui... ex: fun x -> x + 1"
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
                            <Play className="w-4 h-4" /> Compilar e Inferir
                        </button>

                        {error ? (
                            <div className="flex items-center gap-3 text-red-200 bg-red-900/40 p-4 rounded border border-red-500/30 shadow-inner animate-pulse">
                                <AlertTriangle className="w-6 h-6 text-red-400 flex-shrink-0" />
                                <div>
                                    <div className="text-xs font-bold uppercase text-red-400">Falha na Inferência</div>
                                    <div className="text-sm font-mono">{error}</div>
                                </div>
                            </div>
                        ) : result ? (
                            <div className="flex items-center gap-3 text-green-200 bg-green-900/40 p-4 rounded border border-green-500/30 shadow-inner">
                                <Check className="w-6 h-6 text-green-400 flex-shrink-0" />
                                <div>
                                    <div className="text-xs font-bold uppercase text-green-400">Inferência com Sucesso</div>
                                    <div className="text-lg font-mono font-bold tracking-wide">{result}</div>
                                </div>
                            </div>
                        ) : (
                            <div className="h-20 flex items-center justify-center text-slate-600 text-sm border border-dashed border-slate-700 rounded">
                                Aguardando análise...
                            </div>
                        )}
                    </div>
                </div>

                {/* RIGHT COLUMN: Logs */}
                <div className="lg:col-span-7 bg-black rounded-lg border border-slate-700 p-4 font-mono text-sm overflow-hidden flex flex-col shadow-2xl relative">
                    <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-800">
                        <h2 className="text-slate-400 text-xs uppercase tracking-widest flex items-center gap-2">
                            <Terminal className="w-3 h-3" /> Log do Compilador (Stdout)
                        </h2>
                        <span className="text-[10px] text-slate-600 border border-slate-700 px-2 py-0.5 rounded">Detalhado: ON</span>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar font-mono text-xs md:text-sm">
                        {logs.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-full text-slate-700 opacity-50">
                                <Terminal className="w-12 h-12 mb-2" />
                                <span className="text-center">Aguardando entrada...<br/>Clique em 'Compilar e Inferir' para iniciar.</span>
                            </div>
                        )}
                        {logs.map((log) => (
                            <div key={log.id} className={`flex gap-2 ${getLogColor(log.type)} animate-fadeIn border-l-2 border-transparent hover:border-slate-700 pl-2 py-0.5`}>
                                <span className="opacity-30 select-none flex-shrink-0 mt-0.5">{'>'}</span>
                                <span className="break-words leading-relaxed">{log.msg}</span>
                            </div>
                        ))}
                    </div>
                </div>

            </div>
        </div>
    );
}