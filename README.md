# Type Inference Visualizer - MC921 🔍

An interactive educational tool designed to demonstrate the practical implementation of Type Inference algorithms (specifically a simplified version of Algorithm W / Hindley-Milner) in compilers.

This project was developed as part of the Type Systems and Inference seminar for the MC921 - Compilers course at Unicamp.

## 🚀 Features

- Code Editor: Write expressions using an ML/OCaml/Haskell-like syntax.

- Real-time Parsing: Visualizes tokenization and Abstract Syntax Tree (AST) construction.

- Step-by-Step Inference: Detailed logs of the unification process and constraint generation.

- Visual Feedback: Clear indicators for inferred types or type mismatches/errors.

## 🛠️ Tech Stack

- React.js: User Interface.

- Tailwind CSS: Styling.

- Lucide React: Icons.

## 📦 Installation & Setup

1. Clone the repository:

```
git clone [https://gitlab.com/your-username/mc921-type-inference-visualizer.git](https://gitlab.com/your-username/mc921-type-inference-visualizer.git)
```

2. Navigate to the project directory:

```
cd mc921-type-inference-visualizer
```

3. Install dependencies:

```
npm install
```

4. Start the development server:

```
npm start
```

The app will run at http://localhost:3000.

## 🧠 Supported Code Examples

#### Simple Integer

```
10 + 5
```

#### Function (Parameter Inference)

```
fun x -> x + 1
```

#### Polymorphism (Identity)

```
fun x -> x
```

#### Conditional (If-Else)

```
if true then 1 else 0
```

## 👥 Authors

Gustavo Ferreira Gitzel (Practical Implementation)

