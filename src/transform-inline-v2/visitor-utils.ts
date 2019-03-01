import * as ts from 'typescript';
import * as tsutils from 'tsutils';
import { VisitorContext } from './visitor-context';

const objectIdentifier = ts.createIdentifier('object');
const pathIdentifier = ts.createIdentifier('path');

export function setFunctionIfNotExists(name: string, visitorContext: VisitorContext, factory: () => ts.FunctionDeclaration) {
    if (!visitorContext.functionNames.has(name)) {
        visitorContext.functionNames.add(name);
        visitorContext.functionMap.set(name, factory());
    }
    return name;
}

export function getPropertyInfo(symbol: ts.Symbol, visitorContext: VisitorContext) {
    const name: string | undefined = symbol.name;
    if (name === undefined) {
        throw new Error('Missing name in property symbol.');
    }
    if ('valueDeclaration' in symbol) {
        if (!ts.isPropertySignature(symbol.valueDeclaration)) {
            throw new Error('Unsupported declaration kind: ' + symbol.valueDeclaration.kind);
        }
        if (symbol.valueDeclaration.type === undefined) {
            throw new Error('Found property without type.');
        }
        const propertyType = visitorContext.checker.getTypeFromTypeNode(symbol.valueDeclaration.type);
        return {
            name,
            type: propertyType,
            optional: !!symbol.valueDeclaration.questionToken
        };
    } else {
        const propertyType = (symbol as { type?: ts.Type }).type;
        const optional = ((symbol as ts.Symbol).flags & ts.SymbolFlags.Optional) !== 0;
        if (propertyType !== undefined) {
            return {
                name,
                type: propertyType,
                optional
            };
        } else {
            throw new Error('Expected a valueDeclaration or a property type.');
        }
    }
}

export function getTypeReferenceMapping(type: ts.TypeReference, visitorContext: VisitorContext) {
    const mapping: Map<ts.Type, ts.Type> = new Map();
    (function checkBaseTypes(type: ts.TypeReference) {
        if (tsutils.isInterfaceType(type.target)) {
            const baseTypes = visitorContext.checker.getBaseTypes(type.target);
            for (const baseType of baseTypes) {
                if (tsutils.isTypeReference(baseType) && baseType.target.typeParameters !== undefined && baseType.typeArguments !== undefined) {
                    const typeParameters = baseType.target.typeParameters;
                    const typeArguments = baseType.typeArguments;
                    for (let i = 0; i < typeParameters.length; i++) {
                        if (typeParameters[i] !== typeArguments[i]) {
                            mapping.set(typeParameters[i], typeArguments[i]);
                        }
                    }
                    checkBaseTypes(baseType);
                }
            }
        }
    })(type);
    if (type.target.typeParameters !== undefined && type.typeArguments !== undefined) {
        const typeParameters = type.target.typeParameters;
        const typeArguments = type.typeArguments;
        for (let i = 0; i < typeParameters.length; i++) {
            if (typeParameters[i] !== typeArguments[i]) {
                mapping.set(typeParameters[i], typeArguments[i]);
            }
        }
    }
    return mapping;
}

export function getResolvedTypeParameter(type: ts.Type, visitorContext: VisitorContext) {
    let mappedType: ts.Type | undefined;
    for (let i = visitorContext.typeMapperStack.length - 1; i >= 0; i--) {
        mappedType = visitorContext.typeMapperStack[i].get(type);
        if (mappedType !== undefined) {
            break;
        }
    }
    mappedType = mappedType || type.getDefault();
    return mappedType;
}

interface TypeCheckNameMode {
    type: 'type-check';
}

interface KeyofNameMode {
    type: 'keyof';
}

interface IndexedAccessNameMode {
    type: 'indexed-access';
    indexType: ts.Type;
}

type NameMode = TypeCheckNameMode | KeyofNameMode | IndexedAccessNameMode;

export function getFullTypeName(type: ts.Type, visitorContext: VisitorContext, mode: NameMode) {
    // Internal TypeScript API:
    let name = `_${(type as unknown as { id: string }).id}`;
    if (mode.type === 'keyof') {
        name += '_keyof';
    }
    if (mode.type === 'indexed-access') {
        const indexTypeName = getFullTypeName(mode.indexType, visitorContext, { type: 'type-check' });
        name += `_ia__${indexTypeName}`;
    }
    for (const mapping of visitorContext.typeMapperStack) {
        mapping.forEach((typeArgument) => {
            name += `_${(typeArgument as unknown as { id: string }).id}`;
        });
    }
    return name;
}

export function getStringFunction(visitorContext: VisitorContext) {
    const name = '_string';
    return setFunctionIfNotExists(name, visitorContext, () => {
        return createAssertionFunction(
            ts.createStrictInequality(
                ts.createTypeOf(objectIdentifier),
                ts.createStringLiteral('string')
            ),
            `expected a string`,
            name
        );
    });
}

export function getBooleanFunction(visitorContext: VisitorContext) {
    const name = '_boolean';
    return setFunctionIfNotExists(name, visitorContext, () => {
        return createAssertionFunction(
            ts.createStrictInequality(
                ts.createTypeOf(objectIdentifier),
                ts.createStringLiteral('boolean')
            ),
            'expected a boolean',
            name
        );
    });
}

export function getBigintFunction(visitorContext: VisitorContext) {
    const name = '_bigint';
    return setFunctionIfNotExists(name, visitorContext, () => {
        return createAssertionFunction(
            ts.createStrictInequality(
                ts.createTypeOf(objectIdentifier),
                ts.createStringLiteral('bigint')
            ),
            'expected a bigint',
            name
        );
    });
}

export function getNumberFunction(visitorContext: VisitorContext) {
    const name = '_number';
    return setFunctionIfNotExists(name, visitorContext, () => {
        return createAssertionFunction(
            ts.createStrictInequality(
                ts.createTypeOf(objectIdentifier),
                ts.createStringLiteral('number')
            ),
            'expected a number',
            name
        );
    });
}

export function getUndefinedFunction(visitorContext: VisitorContext) {
    const name = '_undefined';
    return setFunctionIfNotExists(name, visitorContext, () => {
        return createAssertionFunction(
            ts.createStrictInequality(
                objectIdentifier,
                ts.createIdentifier('undefined')
            ),
            'expected undefined',
            name
        );
    });
}

export function getNullFunction(visitorContext: VisitorContext) {
    const name = '_null';
    return setFunctionIfNotExists(name, visitorContext, () => {
        return createAssertionFunction(
            ts.createStrictInequality(
                objectIdentifier,
                ts.createNull()
            ),
            'expected null',
            name
        );
    });
}

export function getNeverFunction(visitorContext: VisitorContext) {
    const name = '_never';
    return setFunctionIfNotExists(name, visitorContext, () => {
        return createRejectingFunction('type is never', name);
    });
}

export function getUnknownFunction(visitorContext: VisitorContext) {
    const name = '_unknown';
    return setFunctionIfNotExists(name, visitorContext, () => {
        return createAcceptingFunction(name);
    });
}

export function getAnyFunction(visitorContext: VisitorContext) {
    const name = '_any';
    return setFunctionIfNotExists(name, visitorContext, () => {
        return createAcceptingFunction(name);
    });
}

export function createBinaries(expressions: ts.Expression[], operator: ts.BinaryOperator, baseExpression?: ts.Expression) {
    if (expressions.length >= 1 || baseExpression === undefined) {
        return expressions.reduce((previous, expression) => ts.createBinary(previous, operator, expression));
    } else {
        return baseExpression;
    }
}

export function createAcceptingFunction(functionName: string) {
    return ts.createFunctionDeclaration(
        undefined,
        undefined,
        undefined,
        functionName,
        undefined,
        [],
        undefined,
        ts.createBlock([ts.createReturn(ts.createNull())])
    );
}

export function createRejectingFunction(reason: string, functionName: string) {
    return ts.createFunctionDeclaration(
        undefined,
        undefined,
        undefined,
        functionName,
        undefined,
        [
            ts.createParameter(undefined, undefined, undefined, objectIdentifier, undefined, undefined, undefined)
        ],
        undefined,
        ts.createBlock([
            ts.createReturn(
                createBinaries(
                    [
                        ts.createStringLiteral('validation failed at '),
                        ts.createCall(
                            ts.createPropertyAccess(
                                pathIdentifier,
                                'join'
                            ),
                            undefined,
                            [ts.createStringLiteral('.')]
                        ),
                        ts.createStringLiteral(`: ${reason}`)
                    ],
                    ts.SyntaxKind.PlusToken
                )
            )
        ])
    );
}

export function createConjunctionFunction(functionNames: string[], functionName: string) {
    const conditionsIdentifier = ts.createIdentifier('conditions');
    const conditionIdentifier = ts.createIdentifier('condition');
    const errorIdentifier = ts.createIdentifier('error');
    return ts.createFunctionDeclaration(
        undefined,
        undefined,
        undefined,
        functionName,
        undefined,
        [
            ts.createParameter(undefined, undefined, undefined, objectIdentifier, undefined, undefined, undefined)
        ],
        undefined,
        ts.createBlock([
            ts.createVariableStatement(
                [ts.createModifier(ts.SyntaxKind.ConstKeyword)],
                [
                    ts.createVariableDeclaration(
                        conditionsIdentifier,
                        undefined,
                        ts.createArrayLiteral(
                            functionNames.map((functionName) => ts.createIdentifier(functionName))
                        )
                    )
                ]
            ),
            ts.createForOf(
                undefined,
                ts.createVariableDeclarationList(
                    [ts.createVariableDeclaration(conditionIdentifier, undefined, undefined)],
                    ts.NodeFlags.Const
                ),
                conditionsIdentifier,
                ts.createBlock([
                    ts.createVariableStatement(
                        [ts.createModifier(ts.SyntaxKind.ConstKeyword)],
                        [
                            ts.createVariableDeclaration(
                                errorIdentifier,
                                undefined,
                                ts.createCall(
                                    conditionIdentifier,
                                    undefined,
                                    [objectIdentifier]
                                )
                            )
                        ]
                    ),
                    ts.createIf(
                        errorIdentifier,
                        ts.createReturn(
                            createBinaries(
                                [
                                    ts.createStringLiteral('validation failed at '),
                                    ts.createCall(
                                        ts.createPropertyAccess(
                                            pathIdentifier,
                                            'join'
                                        ),
                                        undefined,
                                        [ts.createStringLiteral('.')]
                                    ),
                                    ts.createStringLiteral(`: `),
                                    errorIdentifier
                                ],
                                ts.SyntaxKind.PlusToken
                            )
                        )
                    )
                ])
            ),
            ts.createReturn(ts.createNull())
        ])
    );
}

export function createDisjunctionFunction(functionNames: string[], functionName: string) {
    const conditionsIdentifier = ts.createIdentifier('conditions');
    const conditionIdentifier = ts.createIdentifier('condition');
    const errorIdentifier = ts.createIdentifier('error');
    return ts.createFunctionDeclaration(
        undefined,
        undefined,
        undefined,
        functionName,
        undefined,
        [
            ts.createParameter(undefined, undefined, undefined, objectIdentifier, undefined, undefined, undefined)
        ],
        undefined,
        ts.createBlock([
            ts.createVariableStatement(
                [ts.createModifier(ts.SyntaxKind.ConstKeyword)],
                [
                    ts.createVariableDeclaration(
                        conditionsIdentifier,
                        undefined,
                        ts.createArrayLiteral(
                            functionNames.map((functionName) => ts.createIdentifier(functionName))
                        )
                    )
                ]
            ),
            ts.createForOf(
                undefined,
                ts.createVariableDeclarationList(
                    [ts.createVariableDeclaration(conditionIdentifier, undefined, undefined)],
                    ts.NodeFlags.Const
                ),
                conditionsIdentifier,
                ts.createBlock([
                    ts.createVariableStatement(
                        [ts.createModifier(ts.SyntaxKind.ConstKeyword)],
                        [
                            ts.createVariableDeclaration(
                                errorIdentifier,
                                undefined,
                                ts.createCall(
                                    conditionIdentifier,
                                    undefined,
                                    [objectIdentifier]
                                )
                            )
                        ]
                    ),
                    ts.createIf(
                        ts.createLogicalNot(errorIdentifier),
                        ts.createReturn(ts.createNull())
                    )
                ])
            ),
            ts.createReturn(
                createBinaries(
                    [
                        ts.createStringLiteral('validation failed at '),
                        ts.createCall(
                            ts.createPropertyAccess(
                                pathIdentifier,
                                'join'
                            ),
                            undefined,
                            [ts.createStringLiteral('.')]
                        ),
                        ts.createStringLiteral(`: there are no valid alternatives.`)
                    ],
                    ts.SyntaxKind.PlusToken
                )
            )
        ])
    );
}

export function createAssertionFunction(failureCondition: ts.Expression, reason: string, functionName: string) {
    return ts.createFunctionDeclaration(
        undefined,
        undefined,
        undefined,
        functionName,
        undefined,
        [
            ts.createParameter(undefined, undefined, undefined, objectIdentifier, undefined, undefined, undefined)
        ],
        undefined,
        ts.createBlock([
            ts.createIf(
                failureCondition,
                ts.createReturn(
                    createBinaries(
                        [
                            ts.createStringLiteral('validation failed at '),
                            ts.createCall(
                                ts.createPropertyAccess(
                                    pathIdentifier,
                                    'join'
                                ),
                                undefined,
                                [ts.createStringLiteral('.')]
                            ),
                            ts.createStringLiteral(`: ${reason}`)
                        ],
                        ts.SyntaxKind.PlusToken
                    )
                ),
                ts.createReturn(ts.createNull())
            )
        ])
    );
}
