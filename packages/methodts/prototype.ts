/* ###
Prompt composition library

The idea is that you can compose complex prompts to compute promps for methods
*/

const parse: string => Prompt<a> = ???

class Prompt<a> {

    public run: a => string

    constructor(r: a => string) {
        this.run = r
    }

    function andThen(other: Prompt<a>): Prompt<a> {
        return new Prompt<a>(a => this.run(a) + ", and then: " + other.run(a))
    }

}

function constant(value: string): Prompt<unknown> = new Prompt<unknown>(_ => value)

const empty: Prompt<unknown> = constant("")

function cond<a>(p: Predicate<a>, then: Prompt<a>): Prompt<a> = 
    new Prompt<a>(a => if(p(a)) then(a) else empty(a))

/** Examples */

type Files = string[]

const commit: Prompt<Files> = paths => 
    `git commit the following files: \n${paths.join("\n")}`

const push: Prompt[Files] = ???

const gitFlow: Prompt<Files> = _comission("Composition between commit, push and other prompts")

// ########

// Function to be used to comission typescript programming work, can be used to make a function compile but comissioned to an agent later
// a: template values
function _comission<a>(prompt: string): never {
    throw new Error("Comission unimplemented")
} 

// Logic Grammar
// Can be parsed from Method description
type Predicate<a> = Val<a> | And<a> | Imply<a> | ForAll<a>

type Val<a> = {
    tag: "predicate-val",
    value: Boolean
}

type And<a> = { a: Predicate<a>, b: Predicate<a> }

type Imply<a> = { a : Predicate<a>, b: Predicate<a> }

type ForAll<a> = { shouldBeTrue: Predicate<a> }

type Exists<a> = { atLeastOneThat: Predicate<a> }

// Quick check extension library

// Exists if Predicate was computed true
type Witness<a> = {
    proofs: Predicate<a>
}

type Gate<a> = Predicate<a> => Maybe<Witness<a>>

// asserter: Compiler of LogicTerm => ()

type DomainPredicates<S> = { [predicateName]: Predicate<S> }

// functions where a and b are types in S
type DomainFunctionSymbols<S> = { [funName]: a => b }

type DomainAxioms<S> = { [axiomName]: Witness<S> }

// At type level, it models the domain theory. At value level, it becomes an instance of the domain
type DomainTheory<S> = {
    sorts: S,
    predicates: DomainPredicates<S>,
    functionSymbols: DomainFunctionSymbols<S>,
    axioms: DomainAxioms<S>
}

type Step<S> = {
    precondition: Predicate<S>,
    postcondition: Predicate<S>,
    prompt: Prompt<S>
}

type Method<S> = {
    steps: Step<S>[]
}

type Methodology<S> = { [methodName]: [Predicate<S>, Method<S>] }

type Strategy = ???