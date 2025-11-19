import React, { useState, useEffect, useRef } from 'react';
import { Play, Terminal, GitBranch, Check, AlertTriangle, Code, ArrowRight, ArrowLeft, Database, Layers, Network, List } from 'lucide-react';
import './index.css';

// --- 1. SISTEMA DE TIPOS ---
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
class TypeList extends Type {
    constructor(elemType) { super("List"); this.elemType = elemType; }
    toString() { return `[${this.elemType}]`; }
}

// --- 2. AST ---
class Expr { constructor() { this.uid = Math.random().toString(36).substr(2, 9); } }
class EInt extends Expr { constructor(val) { super(); this.val = val; } toString() { return `Int(${this.val})`; } children() { return []; } }
class EBool extends Expr { constructor(val) { super(); this.val = val; } toString() { return `Bool(${this.val})`; } children() { return []; } }
class EVar extends Expr { constructor(name) { super(); this.name = name; } toString() { return `Var(${this.name})`; } children() { return []; } }
class EBinOp extends Expr { constructor(op, left, right) { super(); this.op = op; this.left = left; this.right = right; } toString() { return `Op(${this.op})`; } children() { return [this.left, this.right]; } }
class EIf extends Expr { constructor(cond, thenBr, elseBr) { super(); this.cond = cond; this.thenBr = thenBr; this.elseBr = elseBr; } toString() { return `If`; } children() { return [this.cond, this.thenBr, this.elseBr]; } }
class EFun extends Expr { constructor(param, body) { super(); this.param = param; this.body = body; } toString() { return `Fun(${this.param})`; } children() { return [this.body]; } }
class ELet extends Expr { constructor(name, val, body) { super(); this.name = name; this.val = val; this.body = body; } toString() { return `Let(${this.name})`; } children() { return [this.val, this.body]; } }
class EApp extends Expr { constructor(func, arg) { super(); this.func = func; this.arg = arg; } toString() { return `App`; } children() { return [this.func, this.arg]; } }
class EList extends Expr { constructor(head, tail) { super(); this.head = head; this.tail = tail; } toString() { return `List`; } children() { return this.tail ? [this.head, this.tail] : [this.head]; } }
class EEmptyList extends Expr { toString() { return `[]`; } children() { return []; } }

// --- 3. PARSER ---
const tokenize = (input) => {
    const regex = /\s+|(\d+)|(true|false)|(let|in|if|then|else|fun)|(->)|(==|!=|<=|>=|<|>|\+|-|\*|\/|::|=)|([a-zA-Z_][a-zA-Z0-9_]*)|(\[|\]|\(|\)|,)/g;
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
        if (t && t.type === type && (!val || t.val === val)) { this.consume(); return true; }
        return false;
    }
    expect(type, val) { if (!this.match(type, val)) throw new Error(`Erro Sintático: Esperado ${val||type}, achou ${this.peek()?.val}`); }

    parseAtom() {
        const t = this.peek();
        if (!t) throw new Error("Fim inesperado");
        if (t.type === 'NUM') { this.consume(); return new EInt(t.val); }
        if (t.type === 'BOOL') { this.consume(); return new EBool(t.val); }
        if (t.type === 'ID') { this.consume(); return new EVar(t.val); }
        if (this.match('PUNC', '[')) {
            if (this.match('PUNC', ']')) return new EEmptyList();
            const head = this.parseExpression();
            let tail = new EEmptyList();
            if (this.match('PUNC', ',')) {
                const second = this.parseExpression();
                tail = new EList(second, new EEmptyList());
                this.expect('PUNC', ']');
                return new EList(head, tail);
            }
            this.expect('PUNC', ']');
            return new EList(head, tail);
        }
        if (this.match('PUNC', '(')) { const e = this.parseExpression(); this.expect('PUNC', ')'); return e; }
        throw new Error(`Token inesperado: ${t.val}`);
    }
    parseApp() {
        let expr = this.parseAtom();
        while (true) {
            const t = this.peek();
            if (t && (t.type === 'NUM' || t.type === 'BOOL' || t.type === 'ID' || (t.type === 'PUNC' && t.val === '(') || (t.type === 'PUNC' && t.val === '['))) {
                expr = new EApp(expr, this.parseAtom());
            } else break;
        }
        return expr;
    }
    parseBinary() {
        let left = this.parseApp();
        const t = this.peek();
        if (t && t.type === 'OP' && t.val !== '=') { this.consume(); return new EBinOp(t.val, left, this.parseBinary()); }
        return left;
    }
    parseExpression() {
        if (this.match('KW', 'let')) {
            const id = this.consume(); if (id.type !== 'ID') throw new Error("Esperado ID após let");
            this.expect('OP', '='); const val = this.parseExpression();
            this.expect('KW', 'in'); return new ELet(id.val, val, this.parseExpression());
        }
        if (this.match('KW', 'fun')) {
            const p = this.consume(); if (p.type !== 'ID') throw new Error("Esperado param após fun");
            this.expect('ARROW'); return new EFun(p.val, this.parseExpression());
        }
        if (this.match('KW', 'if')) {
            const c = this.parseExpression(); this.expect('KW', 'then');
            const t = this.parseExpression(); this.expect('KW', 'else');
            return new EIf(c, t, this.parseExpression());
        }
        return this.parseBinary();
    }
}

// --- 4. MOTOR ---
let typeVars = [];
const resetTypeVars = () => { typeVars = []; };
const newTypeVar = () => { const tv = new TypeVar(`T${typeVars.length}`); typeVars.push(tv); return tv; };
const prune = (t) => { if (t instanceof TypeVar && t.instance) { t.instance = prune(t.instance); return t.instance; } return t; };
const occursIn = (v, t) => {
    t = prune(t);
    if (v === t) return true;
    if (t instanceof TypeArrow) return occursIn(v, t.param) || occursIn(v, t.ret);
    if (t instanceof TypeList) return occursIn(v, t.elemType);
    return false;
};
const snapshotTypes = () => typeVars.map(tv => ({ name: tv.name, val: tv.instance ? prune(tv).toString() : '?' }));

const unify = (t1, t2, trace, ctx, nodeId) => {
    t1 = prune(t1); t2 = prune(t2);
    if (t1 === t2) return;
    if (t1 instanceof TypeInt && t2 instanceof TypeInt) return;
    if (t1 instanceof TypeBool && t2 instanceof TypeBool) return;
    if (t1 instanceof TypeVar) {
        if (occursIn(t1, t2)) throw new Error(`Occurs Check: Ciclo infinito (${t1} em ${t2})`);
        t1.instance = t2;
        trace(`UNIFICAR: ${t1.name} ⟵ ${t2} (${ctx})`, 'success', snapshotTypes(), nodeId);
        return;
    }
    if (t2 instanceof TypeVar) { unify(t2, t1, trace, ctx, nodeId); return; }
    if (t1 instanceof TypeArrow && t2 instanceof TypeArrow) {
        unify(t1.param, t2.param, trace, 'Param Função', nodeId);
        unify(t1.ret, t2.ret, trace, 'Retorno Função', nodeId);
        return;
    }
    if (t1 instanceof TypeList && t2 instanceof TypeList) {
        unify(t1.elemType, t2.elemType, trace, 'Elemento Lista', nodeId);
        return;
    }
    throw new Error(`Incompatível: ${t1} vs ${t2}`);
};

const analyze = (env, expr, trace) => {
    trace(`AST: Analisando ${expr.toString()}`, 'ast', snapshotTypes(), expr.uid);

    if (expr instanceof EInt) { return new TypeInt(); }
    if (expr instanceof EBool) { return new TypeBool(); }
    if (expr instanceof EVar) {
        const t = env[expr.name];
        if (!t) throw new Error(`Variável '${expr.name}' não existe`);
        return t;
    }
    if (expr instanceof EEmptyList) {
        const tv = newTypeVar();
        return new TypeList(tv);
    }
    if (expr instanceof EList) {
        const tHead = analyze(env, expr.head, trace);
        const tTail = analyze(env, expr.tail, trace);
        unify(tTail, new TypeList(tHead), trace, "Lista Homogênea", expr.uid);
        return new TypeList(tHead);
    }
    if (expr instanceof EBinOp) {
        const tL = analyze(env, expr.left, trace);
        const tR = analyze(env, expr.right, trace);
        trace(`RESTRIÇÃO: ${expr.op} exige tipos compatíveis`, 'info', snapshotTypes(), expr.uid);
        if (['+', '-', '*', '/'].includes(expr.op)) {
            unify(tL, new TypeInt(), trace, `Esq de '${expr.op}'`, expr.uid);
            unify(tR, new TypeInt(), trace, `Dir de '${expr.op}'`, expr.uid);
            return new TypeInt();
        } else {
            unify(tL, tR, trace, `Operandos de '${expr.op}'`, expr.uid);
            return new TypeBool();
        }
    }
    if (expr instanceof EIf) {
        const tC = analyze(env, expr.cond, trace);
        unify(tC, new TypeBool(), trace, "Condição If", expr.uid);
        const tT = analyze(env, expr.thenBr, trace);
        const tE = analyze(env, expr.elseBr, trace);
        unify(tT, tE, trace, "Ramos Then/Else", expr.uid);
        return tT;
    }
    if (expr instanceof EFun) {
        const pT = newTypeVar();
        const newEnv = { ...env, [expr.param]: pT };
        trace(`ESCOPO: ${expr.param} : ${pT.name}`, 'warn', snapshotTypes(), expr.uid);
        const bT = analyze(newEnv, expr.body, trace);
        return new TypeArrow(pT, bT);
    }
    if (expr instanceof EApp) {
        const tF = analyze(env, expr.func, trace);
        const tA = analyze(env, expr.arg, trace);
        const tR = newTypeVar();
        unify(tF, new TypeArrow(tA, tR), trace, "Aplicação", expr.uid);
        return tR;
    }
    if (expr instanceof ELet) {
        const vT = analyze(env, expr.val, trace);
        return analyze({ ...env, [expr.name]: vT }, expr.body, trace);
    }
    throw new Error("Desconhecido");
};

// --- 5. UI COMPONENTS ---

const ASTNode = ({ node, activeNodeId }) => {
    if (!node) return null;
    const isActive = node.uid === activeNodeId;
    const children = node.children();

    return (
        <div className="flex flex-col items-center">
            <div className={`
        border-2 rounded-lg px-3 py-2 mb-2 text-sm font-bold transition-all duration-300
        ${isActive ? 'bg-yellow-500/20 border-yellow-400 text-yellow-200 scale-110 shadow-[0_0_15px_rgba(250,204,21,0.5)]' : 'bg-slate-800 border-slate-600 text-slate-300'}
      `}>
                {node.toString()}
            </div>
            {children.length > 0 && (
                <div className="flex gap-4 relative pt-4 before:content-[''] before:absolute before:top-0 before:left-1/2 before:-translate-x-1/2 before:h-4 before:w-px before:bg-slate-600">
                    {children.map((child, i) => (
                        <div key={i} className="relative flex flex-col items-center before:content-[''] before:absolute before:-top-4 before:left-1/2 before:-translate-x-1/2 before:h-4 before:w-px before:bg-slate-600 first:before:origin-bottom-right last:before:origin-bottom-left">
                            <ASTNode node={child} activeNodeId={activeNodeId} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

const SCENARIOS = [
    { id: 1, title: "1. Básico (+)", code: "fun x -> x + 1" },
    { id: 2, title: "2. Listas", code: "[1, 2]" },
    { id: 3, title: "3. Lista Genérica", code: "fun x -> [x]" },
    { id: 4, title: "4. Erro Lista", code: "[1, true]" },
    { id: 5, title: "5. Polimorfismo", code: "fun x -> x" },
    { id: 6, title: "6. Occurs Check", code: "fun x -> x x" },
];

export default function App() {
    const [code, setCode] = useState(SCENARIOS[0].code);
    const [steps, setSteps] = useState([]);
    const [currentStep, setCurrentStep] = useState(-1);
    const [error, setError] = useState(null);
    const [finalType, setFinalType] = useState(null);
    const [astRoot, setAstRoot] = useState(null);

    const runAnalysis = () => {
        resetTypeVars();
        setSteps([]);
        setCurrentStep(-1);
        setError(null);
        setFinalType(null);
        setAstRoot(null);

        const recordedSteps = [];
        const trace = (msg, type, memory, nodeId) => recordedSteps.push({ msg, type, memory: memory || snapshotTypes(), nodeId });

        try {
            const tokens = tokenize(code);
            const parser = new Parser(tokens);
            const ast = parser.parseExpression();
            setAstRoot(ast);

            const resultType = analyze({}, ast, trace);
            setFinalType(prune(resultType).toString());
        } catch (e) {
            trace(`FALHA: ${e.message}`, 'error', snapshotTypes(), null);
            setError(e.message);
        }
        setSteps(recordedSteps);
        setCurrentStep(0);
    };

    const nextStep = () => setCurrentStep(p => Math.min(p + 1, steps.length - 1));
    const prevStep = () => setCurrentStep(p => Math.max(p - 1, 0));

    const getLogColor = (type) => {
        if (type === 'success') return 'text-green-400 font-bold';
        if (type === 'error') return 'text-red-500 font-bold bg-red-900/20 p-1 rounded';
        if (type === 'warn') return 'text-yellow-400';
        if (type === 'ast') return 'text-purple-400';
        return 'text-slate-300';
    };

    const currentStepData = steps[currentStep] || {};
    const currentMemory = currentStepData.memory || [];
    const activeNodeId = currentStepData.nodeId;

    return (
        <div className="flex flex-col h-screen bg-slate-950 text-slate-100 p-4 font-mono overflow-hidden">
            <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #0f172a; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 3px; }
      `}</style>

            <header className="mb-4 pb-2 border-b border-slate-800 flex justify-between items-center shrink-0">
                <div>
                    <h1 className="text-xl font-bold text-blue-500 flex items-center gap-2">
                        <Terminal className="w-6 h-6" /> Visualizador de Inferência (v3.0)
                    </h1>
                    <p className="text-slate-400 text-xs">MC921 - Unicamp | Estruturas, Polimorfismo & Segurança</p>
                </div>
                <div className="flex gap-2">
                    {SCENARIOS.map(s => (
                        <button key={s.id} onClick={() => setCode(s.code)} className="px-3 py-1 text-xs bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 transition">
                            {s.title}
                        </button>
                    ))}
                </div>
            </header>

            <div className="grid grid-cols-12 gap-4 h-full min-h-0">

                {/* COLUNA 1: Editor & Log (3 colunas) */}
                <div className="col-span-3 flex flex-col gap-4">
                    <div className="flex-1 flex flex-col gap-2">
                        <div className="bg-slate-900 border border-slate-700 p-2 rounded flex-none">
                            <div className="text-xs text-blue-400 font-bold mb-1">Código Fonte</div>
                            <textarea
                                value={code} onChange={(e) => setCode(e.target.value)}
                                className="w-full h-24 bg-transparent outline-none text-sm resize-none font-fira"
                                spellCheck="false"
                            />
                        </div>
                        <button onClick={runAnalysis} className="bg-blue-600 hover:bg-blue-500 text-white py-2 rounded font-bold shadow flex justify-center items-center gap-2 text-sm">
                            <Play className="w-4 h-4" /> Compilar (Algorithm W)
                        </button>
                    </div>

                    <div className="flex-[2] bg-slate-900 rounded border border-slate-800 flex flex-col overflow-hidden">
                        <div className="bg-slate-950 p-2 text-xs font-bold text-slate-500 border-b border-slate-800 flex justify-between">
                            <span>TRACE DE EXECUÇÃO</span>
                            <span className="text-slate-400">{steps.length > 0 ? `${currentStep + 1}/${steps.length}` : "0/0"}</span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                            {steps.map((step, idx) => (
                                <div key={idx} className={`text-xs border-l-2 pl-2 py-0.5 ${idx === currentStep ? 'border-yellow-500 bg-yellow-500/10' : 'border-transparent opacity-50'}`}>
                                    <span className={getLogColor(step.type)}>{step.msg}</span>
                                </div>
                            ))}
                        </div>
                        <div className="p-2 bg-slate-950 flex gap-2 justify-center border-t border-slate-800">
                            <button onClick={prevStep} disabled={currentStep <= 0} className="p-1 bg-slate-800 rounded disabled:opacity-30"><ArrowLeft className="w-4 h-4"/></button>
                            <button onClick={nextStep} disabled={currentStep >= steps.length - 1} className="p-1 bg-slate-800 rounded disabled:opacity-30"><ArrowRight className="w-4 h-4"/></button>
                        </div>
                    </div>
                </div>

                {/* COLUNA 2: ÁRVORE VISUAL (6 colunas) */}
                <div className="col-span-7 bg-slate-900 rounded-xl border border-slate-800 shadow-2xl overflow-hidden flex flex-col relative">
                    <div className="absolute top-2 left-2 z-10 bg-slate-950/80 px-2 py-1 rounded text-xs font-bold text-slate-500 flex gap-2 border border-slate-800">
                        <Network className="w-3 h-3" /> Árvore Sintática (AST)
                    </div>
                    <div className="flex-1 flex items-center justify-center overflow-auto p-8 custom-scrollbar bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px]">
                        {astRoot ? (
                            <ASTNode node={astRoot} activeNodeId={activeNodeId} />
                        ) : (
                            <div className="text-slate-700 italic">Aguardando análise...</div>
                        )}
                    </div>
                    {(finalType || error) && (
                        <div className={`absolute bottom-4 right-4 p-3 rounded border shadow-lg ${error ? 'bg-red-900/90 border-red-500 text-red-200' : 'bg-green-900/90 border-green-500 text-green-200'}`}>
                            <div className="text-xs font-bold uppercase mb-1">{error ? 'Erro' : 'Sucesso'}</div>
                            <div className="font-mono font-bold text-lg">{error || finalType}</div>
                        </div>
                    )}
                </div>

                {/* COLUNA 3: Memória (3 colunas) */}
                <div className="col-span-2 flex flex-col bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
                    <div className="bg-slate-950 p-2 border-b border-slate-800">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <Database className="w-3 h-3"/> Memória (Heap)
            </span>
                    </div>
                    <div className="flex-1 p-2 overflow-y-auto custom-scrollbar">
                        <div className="space-y-2">
                            {currentMemory.length === 0 && <div className="text-slate-700 text-xs italic text-center mt-10">Vazia</div>}
                            {currentMemory.map((tv) => (
                                <div key={tv.name} className="flex flex-col bg-slate-950 p-2 rounded border border-slate-800">
                                    <span className="text-yellow-500 font-bold font-mono text-xs mb-1">{tv.name}</span>
                                    <span className={`font-mono text-sm font-bold text-right ${tv.val === '?' ? 'text-slate-600' : 'text-green-400'}`}>
                    {tv.val}
                  </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

            </div>
        </div>
    );
}