import ts from "typescript";

function createSourceFile(filePath, sourceText) {
  const extension = filePath.split(".").pop()?.toLowerCase();
  let scriptKind = ts.ScriptKind.TS;

  if (extension === "tsx") {
    scriptKind = ts.ScriptKind.TSX;
  } else if (extension === "jsx") {
    scriptKind = ts.ScriptKind.JSX;
  } else if (extension === "js") {
    scriptKind = ts.ScriptKind.JS;
  } else if (extension === "mjs") {
    scriptKind = ts.ScriptKind.JS;
  }

  return ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
}

function isJavaScriptLikeFile(filePath) {
  return /\.(?:[cm]?js|jsx)$/u.test(filePath);
}

function getLine(sourceFile, position) {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function siteIdFor(sourceFile, family, node) {
  return `${family}:${sourceFile.fileName}:${node.getStart(sourceFile)}`;
}

function unwrapReturnStatement(statement) {
  if (ts.isReturnStatement(statement)) {
    return statement;
  }

  if (ts.isBlock(statement) && statement.statements.length === 1) {
    const [nestedStatement] = statement.statements;
    if (ts.isReturnStatement(nestedStatement)) {
      return nestedStatement;
    }
  }

  return null;
}

function isSafeIfReturnExpression(expression) {
  return !(
    ts.isObjectLiteralExpression(expression) ||
    ts.isArrayLiteralExpression(expression)
  );
}

function containsUnsupportedLoopControl(node) {
  let unsupported = false;

  function visit(currentNode) {
    if (unsupported) {
      return;
    }

    if (
      ts.isBreakStatement(currentNode) ||
      ts.isContinueStatement(currentNode) ||
      ts.isReturnStatement(currentNode) ||
      ts.isYieldExpression(currentNode) ||
      ts.isAwaitExpression(currentNode)
    ) {
      unsupported = true;
      return;
    }

    ts.forEachChild(currentNode, visit);
  }

  visit(node);
  return unsupported;
}

function isObjectEntriesCall(expression) {
  return (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    ts.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === "Object" &&
    expression.expression.name.text === "entries" &&
    expression.arguments.length === 1
  );
}

function isAwaitedPromiseAll(expression) {
  if (!ts.isAwaitExpression(expression)) {
    return false;
  }

  const awaitedExpression = expression.expression;
  return (
    ts.isCallExpression(awaitedExpression) &&
    ts.isPropertyAccessExpression(awaitedExpression.expression) &&
    ts.isIdentifier(awaitedExpression.expression.expression) &&
    awaitedExpression.expression.expression.text === "Promise" &&
    awaitedExpression.expression.name.text === "all" &&
    awaitedExpression.arguments.length === 1 &&
    ts.isArrayLiteralExpression(awaitedExpression.arguments[0])
  );
}

function isSimplePropertyAssignment(property) {
  if (ts.isShorthandPropertyAssignment(property)) {
    return true;
  }

  return (
    ts.isPropertyAssignment(property) &&
    !property.name.questionToken &&
    !ts.isComputedPropertyName(property.name)
  );
}

function collectStatementListCandidates(sourceFile, statements, candidates) {
  for (let index = 0; index < statements.length - 1; index += 1) {
    const currentStatement = statements[index];
    const nextStatement = statements[index + 1];

    if (
      ts.isIfStatement(currentStatement) &&
      !currentStatement.elseStatement &&
      ts.isReturnStatement(nextStatement)
    ) {
      const thenReturn = unwrapReturnStatement(currentStatement.thenStatement);

      if (
        thenReturn?.expression &&
        nextStatement.expression &&
        isSafeIfReturnExpression(thenReturn.expression) &&
        isSafeIfReturnExpression(nextStatement.expression)
      ) {
        candidates.push({
          family: "if-return",
          filePath: sourceFile.fileName,
          line: getLine(sourceFile, currentStatement.getStart(sourceFile)),
          nodeEnd: nextStatement.end,
          nodeStart: currentStatement.getStart(sourceFile),
          siteId: siteIdFor(sourceFile, "if-return", currentStatement),
        });
      }
    }
  }

  for (let index = 0; index < statements.length; index += 1) {
    let cursor = index;
    const sequence = [];

    while (cursor < statements.length) {
      const statement = statements[cursor];
      if (!ts.isExpressionStatement(statement)) {
        break;
      }

      if (
        !ts.isAwaitExpression(statement.expression) ||
        !ts.isCallExpression(statement.expression.expression) ||
        !ts.isIdentifier(statement.expression.expression.expression)
      ) {
        break;
      }

      sequence.push(statement);
      cursor += 1;
    }

    if (sequence.length >= 4) {
      const firstStatement = sequence[0];
      candidates.push({
        family: "await-call-sequence",
        filePath: sourceFile.fileName,
        line: getLine(sourceFile, firstStatement.getStart(sourceFile)),
        nodeEnd: sequence.at(-1)?.end ?? firstStatement.end,
        nodeStart: firstStatement.getStart(sourceFile),
        siteId: siteIdFor(sourceFile, "await-call-sequence", firstStatement),
      });
      index = cursor - 1;
    }
  }
}

function collectCandidates(sourceFile) {
  const candidates = [];

  function visit(node) {
    if (ts.isBlock(node)) {
      collectStatementListCandidates(sourceFile, [...node.statements], candidates);
    }

    if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
      collectStatementListCandidates(sourceFile, [...node.statements], candidates);
    }

    if (ts.isForOfStatement(node)) {
      if (
        isObjectEntriesCall(node.expression) &&
        ts.isVariableDeclarationList(node.initializer) &&
        node.initializer.declarations.length === 1 &&
        ts.isArrayBindingPattern(node.initializer.declarations[0]?.name) &&
        !containsUnsupportedLoopControl(node.statement)
      ) {
        candidates.push({
          family: "for-of-object-entries",
          filePath: sourceFile.fileName,
          line: getLine(sourceFile, node.getStart(sourceFile)),
          nodeEnd: node.end,
          nodeStart: node.getStart(sourceFile),
          siteId: siteIdFor(sourceFile, "for-of-object-entries", node),
        });
      }
    }

    if (ts.isVariableStatement(node)) {
      const [declaration] = node.declarationList.declarations;
      if (
        node.declarationList.declarations.length === 1 &&
        declaration &&
        ts.isArrayBindingPattern(declaration.name) &&
        declaration.initializer &&
        isAwaitedPromiseAll(declaration.initializer)
      ) {
        candidates.push({
          family: "await-promise-all",
          filePath: sourceFile.fileName,
          line: getLine(sourceFile, node.getStart(sourceFile)),
          nodeEnd: node.end,
          nodeStart: node.getStart(sourceFile),
          siteId: siteIdFor(sourceFile, "await-promise-all", node),
        });
      }
    }

    if (
      isJavaScriptLikeFile(sourceFile.fileName) &&
      ts.isObjectLiteralExpression(node) &&
      node.properties.length >= 2 &&
      node.properties.every(isSimplePropertyAssignment)
    ) {
      candidates.push({
        family: "object-literal-assign",
        filePath: sourceFile.fileName,
        line: getLine(sourceFile, node.getStart(sourceFile)),
        nodeEnd: node.end,
        nodeStart: node.getStart(sourceFile),
        siteId: siteIdFor(sourceFile, "object-literal-assign", node),
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return candidates;
}

function filterOverlappingCandidates(candidates) {
  const orderedCandidates = [...candidates].sort((left, right) => {
    if (left.nodeStart !== right.nodeStart) {
      return left.nodeStart - right.nodeStart;
    }

    return right.nodeEnd - left.nodeEnd;
  });
  const acceptedCandidates = [];

  for (const candidate of orderedCandidates) {
    const overlapsExistingCandidate = acceptedCandidates.some((acceptedCandidate) =>
      !(candidate.nodeEnd <= acceptedCandidate.nodeStart || candidate.nodeStart >= acceptedCandidate.nodeEnd),
    );

    if (!overlapsExistingCandidate) {
      acceptedCandidates.push(candidate);
    }
  }

  return acceptedCandidates.sort((left, right) => left.nodeStart - right.nodeStart);
}

function negateExpression(factory, expression) {
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
    return expression.operand;
  }

  return factory.createPrefixUnaryExpression(
    ts.SyntaxKind.ExclamationToken,
    factory.createParenthesizedExpression(expression),
  );
}

function buildObjectAssignExpression(factory, properties, symbol) {
  const chunks = [];

  if (symbol === 1) {
    for (const property of properties) {
      chunks.push(factory.createObjectLiteralExpression([property], false));
    }
  } else if (symbol === 2) {
    const splitIndex = Math.ceil(properties.length / 2);
    chunks.push(factory.createObjectLiteralExpression(properties.slice(0, splitIndex), false));
    chunks.push(factory.createObjectLiteralExpression(properties.slice(splitIndex), false));
  } else {
    const firstProperty = properties[0];
    const lastProperty = properties.at(-1);
    const middleProperties = properties.slice(1, -1);

    chunks.push(factory.createObjectLiteralExpression([firstProperty], false));
    if (middleProperties.length > 0) {
      chunks.push(factory.createObjectLiteralExpression(middleProperties, false));
    }
    if (lastProperty && lastProperty !== firstProperty) {
      chunks.push(factory.createObjectLiteralExpression([lastProperty], false));
    }
  }

  return factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createIdentifier("Object"),
      factory.createIdentifier("assign"),
    ),
    undefined,
    [
      factory.createObjectLiteralExpression([], false),
      ...chunks,
    ],
  );
}

function transformStatementList(factory, statements, assignmentMap) {
  const nextStatements = [];

  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    const statementStart = statement.pos >= 0 ? statement.getStart() : -1;
    const siteId =
      statementStart >= 0
        ? assignmentMap.startIndexToSiteId.get(statementStart)
        : null;

    if (!siteId) {
      nextStatements.push(statement);
      continue;
    }

    const assignment = assignmentMap.bySiteId.get(siteId);
    if (!assignment) {
      nextStatements.push(statement);
      continue;
    }

    if (assignment.family === "if-return" && index < statements.length - 1) {
      const nextStatement = statements[index + 1];
      if (
        ts.isIfStatement(statement) &&
        !statement.elseStatement &&
        ts.isReturnStatement(nextStatement)
      ) {
        const thenReturn = unwrapReturnStatement(statement.thenStatement);
        if (thenReturn?.expression && nextStatement.expression) {
          const tempIdentifier = factory.createIdentifier(
            `__wm_if_${assignment.symbol}_${assignment.line}`,
          );

          if (assignment.symbol === 1) {
            nextStatements.push(
              factory.createReturnStatement(
                factory.createConditionalExpression(
                  statement.expression,
                  factory.createToken(ts.SyntaxKind.QuestionToken),
                  thenReturn.expression,
                  factory.createToken(ts.SyntaxKind.ColonToken),
                  nextStatement.expression,
                ),
              ),
            );
          } else if (assignment.symbol === 2) {
            nextStatements.push(
              factory.updateIfStatement(
                statement,
                negateExpression(factory, statement.expression),
                factory.createReturnStatement(nextStatement.expression),
                undefined,
              ),
            );
            nextStatements.push(factory.createReturnStatement(thenReturn.expression));
          } else if (assignment.symbol === 3) {
            nextStatements.push(
              factory.createVariableStatement(
                undefined,
                factory.createVariableDeclarationList(
                  [
                    factory.createVariableDeclaration(
                      tempIdentifier,
                      undefined,
                      undefined,
                      factory.createConditionalExpression(
                        statement.expression,
                        factory.createToken(ts.SyntaxKind.QuestionToken),
                        thenReturn.expression,
                        factory.createToken(ts.SyntaxKind.ColonToken),
                        nextStatement.expression,
                      ),
                    ),
                  ],
                  ts.NodeFlags.Const,
                ),
              ),
            );
            nextStatements.push(factory.createReturnStatement(tempIdentifier));
          } else {
            nextStatements.push(statement);
            nextStatements.push(nextStatement);
          }

          index += 1;
          continue;
        }
      }
    }

    if (assignment.family === "await-call-sequence") {
      const sequence = [];
      let cursor = index;

      while (cursor < statements.length) {
        const currentStatement = statements[cursor];
        if (
          !ts.isExpressionStatement(currentStatement) ||
          !ts.isAwaitExpression(currentStatement.expression) ||
          !ts.isCallExpression(currentStatement.expression.expression) ||
          !ts.isIdentifier(currentStatement.expression.expression.expression)
        ) {
          break;
        }

        sequence.push(currentStatement);
        cursor += 1;
      }

      if (sequence.length >= 4) {
        const firstCall = sequence[0].expression.expression;
        const argumentsList = firstCall.arguments;
        const registrars = sequence.map((entry) =>
          factory.createIdentifier(entry.expression.expression.expression.text),
        );
        const registrarIdentifier = factory.createIdentifier("__wm_register");
        const registrarArrayIdentifier = factory.createIdentifier(
          `__wm_registrars_${assignment.line}`,
        );

        if (assignment.symbol === 1) {
          nextStatements.push(
            factory.createForOfStatement(
              undefined,
              factory.createVariableDeclarationList(
                [factory.createVariableDeclaration(registrarIdentifier, undefined, undefined, undefined)],
                ts.NodeFlags.Const,
              ),
              factory.createArrayLiteralExpression(registrars, false),
              factory.createBlock(
                [
                  factory.createExpressionStatement(
                    factory.createAwaitExpression(
                      factory.createCallExpression(
                        registrarIdentifier,
                        undefined,
                        [...argumentsList],
                      ),
                    ),
                  ),
                ],
                true,
              ),
            ),
          );
        } else if (assignment.symbol === 2) {
          nextStatements.push(
            factory.createVariableStatement(
              undefined,
              factory.createVariableDeclarationList(
                [
                  factory.createVariableDeclaration(
                    registrarArrayIdentifier,
                    undefined,
                    undefined,
                    factory.createArrayLiteralExpression(registrars, false),
                  ),
                ],
                ts.NodeFlags.Const,
              ),
            ),
          );
          nextStatements.push(
            factory.createForOfStatement(
              undefined,
              factory.createVariableDeclarationList(
                [factory.createVariableDeclaration(registrarIdentifier, undefined, undefined, undefined)],
                ts.NodeFlags.Const,
              ),
              registrarArrayIdentifier,
              factory.createBlock(
                [
                  factory.createExpressionStatement(
                    factory.createAwaitExpression(
                      factory.createCallExpression(
                        registrarIdentifier,
                        undefined,
                        [...argumentsList],
                      ),
                    ),
                  ),
                ],
                true,
              ),
            ),
          );
        } else if (assignment.symbol === 3) {
          nextStatements.push(
            factory.createForOfStatement(
              undefined,
              factory.createVariableDeclarationList(
                [factory.createVariableDeclaration(registrarIdentifier, undefined, undefined, undefined)],
                ts.NodeFlags.Const,
              ),
              factory.createCallExpression(
                factory.createPropertyAccessExpression(
                  factory.createArrayLiteralExpression(registrars, false),
                  factory.createIdentifier("values"),
                ),
                undefined,
                [],
              ),
              factory.createBlock(
                [
                  factory.createExpressionStatement(
                    factory.createAwaitExpression(
                      factory.createCallExpression(
                        registrarIdentifier,
                        undefined,
                        [...argumentsList],
                      ),
                    ),
                  ),
                ],
                true,
              ),
            ),
          );
        } else {
          nextStatements.push(...sequence);
        }

        index = cursor - 1;
        continue;
      }
    }

    nextStatements.push(statement);
  }

  return nextStatements;
}

function createTransformer(assignments) {
  const assignmentMap = {
    bySiteId: new Map(assignments.map((assignment) => [assignment.siteId, assignment])),
    startIndexToSiteId: new Map(assignments.map((assignment) => [assignment.nodeStart, assignment.siteId])),
  };

  return (context) => {
    const { factory } = context;

    function visit(node) {
      if (ts.isBlock(node)) {
        const transformedStatements = transformStatementList(
          factory,
          [...node.statements],
          assignmentMap,
        );

        return factory.updateBlock(
          node,
          transformedStatements.map((statement) => ts.visitEachChild(statement, visit, context)),
        );
      }

      if (ts.isCaseClause(node)) {
        const transformedStatements = transformStatementList(
          factory,
          [...node.statements],
          assignmentMap,
        );

        return factory.updateCaseClause(
          node,
          node.expression,
          transformedStatements.map((statement) => ts.visitEachChild(statement, visit, context)),
        );
      }

      if (ts.isDefaultClause(node)) {
        const transformedStatements = transformStatementList(
          factory,
          [...node.statements],
          assignmentMap,
        );

        return factory.updateDefaultClause(
          node,
          transformedStatements.map((statement) => ts.visitEachChild(statement, visit, context)),
        );
      }

      const nodeStart = node.pos >= 0 ? node.getStart() : -1;
      const siteId = nodeStart >= 0 ? assignmentMap.startIndexToSiteId.get(nodeStart) : null;
      const assignment = siteId ? assignmentMap.bySiteId.get(siteId) : null;

      if (assignment?.family === "for-of-object-entries" && ts.isForOfStatement(node)) {
        const bindingPattern = node.initializer.declarations[0]?.name;
        const entriesExpression = node.expression.arguments[0];
        const body =
          ts.isBlock(node.statement) ? node.statement : factory.createBlock([node.statement], true);
        const statements = [...body.statements];
        const entryIdentifier = factory.createIdentifier(`__wm_entry_${assignment.line}`);
        const entriesIdentifier = factory.createIdentifier(`__wm_entries_${assignment.line}`);

        if (assignment.symbol === 1) {
          return factory.createExpressionStatement(
            factory.createCallExpression(
              factory.createPropertyAccessExpression(
                factory.createCallExpression(
                  factory.createPropertyAccessExpression(
                    factory.createIdentifier("Object"),
                    factory.createIdentifier("entries"),
                  ),
                  undefined,
                  [entriesExpression],
                ),
                factory.createIdentifier("forEach"),
              ),
              undefined,
              [
                factory.createArrowFunction(
                  undefined,
                  undefined,
                  [factory.createParameterDeclaration(undefined, undefined, bindingPattern, undefined, undefined, undefined)],
                  undefined,
                  factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
                  factory.createBlock(statements, true),
                ),
              ],
            ),
          );
        }

        if (assignment.symbol === 2) {
          return factory.createForOfStatement(
            undefined,
            factory.createVariableDeclarationList(
              [
                factory.createVariableDeclaration(
                  entryIdentifier,
                  undefined,
                  undefined,
                  undefined,
                ),
              ],
              ts.NodeFlags.Const,
            ),
            factory.createCallExpression(
              factory.createPropertyAccessExpression(
                factory.createIdentifier("Object"),
                factory.createIdentifier("entries"),
              ),
              undefined,
              [entriesExpression],
            ),
            factory.createBlock(
              [
                factory.createVariableStatement(
                  undefined,
                  factory.createVariableDeclarationList(
                    [
                      factory.createVariableDeclaration(
                        bindingPattern,
                        undefined,
                        undefined,
                        entryIdentifier,
                      ),
                    ],
                    ts.NodeFlags.Const,
                  ),
                ),
                ...statements,
              ],
              true,
            ),
          );
        }

        if (assignment.symbol === 3) {
          return factory.createBlock(
            [
              factory.createVariableStatement(
                undefined,
                factory.createVariableDeclarationList(
                  [
                    factory.createVariableDeclaration(
                      entriesIdentifier,
                      undefined,
                      undefined,
                      factory.createCallExpression(
                        factory.createPropertyAccessExpression(
                          factory.createIdentifier("Object"),
                          factory.createIdentifier("entries"),
                        ),
                        undefined,
                        [entriesExpression],
                      ),
                    ),
                  ],
                  ts.NodeFlags.Const,
                ),
              ),
              factory.createForStatement(
                factory.createVariableDeclarationList(
                  [
                    factory.createVariableDeclaration(
                      factory.createIdentifier(`__wm_index_${assignment.line}`),
                      undefined,
                      undefined,
                      factory.createNumericLiteral(0),
                    ),
                  ],
                  ts.NodeFlags.Let,
                ),
                factory.createBinaryExpression(
                  factory.createIdentifier(`__wm_index_${assignment.line}`),
                  factory.createToken(ts.SyntaxKind.LessThanToken),
                  factory.createPropertyAccessExpression(entriesIdentifier, "length"),
                ),
                factory.createPostfixIncrement(
                  factory.createIdentifier(`__wm_index_${assignment.line}`),
                ),
                factory.createBlock(
                  [
                    factory.createVariableStatement(
                      undefined,
                      factory.createVariableDeclarationList(
                        [
                          factory.createVariableDeclaration(
                            bindingPattern,
                            undefined,
                            undefined,
                            factory.createElementAccessExpression(
                              entriesIdentifier,
                              factory.createIdentifier(`__wm_index_${assignment.line}`),
                            ),
                          ),
                        ],
                        ts.NodeFlags.Const,
                      ),
                    ),
                    ...statements,
                  ],
                  true,
                ),
              ),
            ],
            true,
          );
        }
      }

      if (assignment?.family === "await-promise-all" && ts.isVariableStatement(node)) {
        const [declaration] = node.declarationList.declarations;
        if (
          declaration &&
          ts.isArrayBindingPattern(declaration.name) &&
          declaration.initializer &&
          isAwaitedPromiseAll(declaration.initializer)
        ) {
          const promiseAllCall = declaration.initializer.expression;
          const arrayLiteral = promiseAllCall.arguments[0];

          if (!ts.isArrayLiteralExpression(arrayLiteral)) {
            return node;
          }

          if (assignment.symbol === 1) {
            const pendingIdentifier = factory.createIdentifier(`__wm_pending_${assignment.line}`);
            return factory.createBlock(
              [
                factory.createVariableStatement(
                  undefined,
                  factory.createVariableDeclarationList(
                    [
                      factory.createVariableDeclaration(
                        pendingIdentifier,
                        undefined,
                        undefined,
                        factory.createArrayLiteralExpression(arrayLiteral.elements, false),
                      ),
                    ],
                    ts.NodeFlags.Const,
                  ),
                ),
                factory.createVariableStatement(
                  node.modifiers,
                  factory.createVariableDeclarationList(
                    [
                      factory.createVariableDeclaration(
                        declaration.name,
                        undefined,
                        undefined,
                        factory.createAwaitExpression(
                          factory.createCallExpression(
                            factory.createPropertyAccessExpression(
                              factory.createIdentifier("Promise"),
                              factory.createIdentifier("all"),
                            ),
                            undefined,
                            [pendingIdentifier],
                          ),
                        ),
                      ),
                    ],
                    node.declarationList.flags,
                  ),
                ),
              ],
              true,
            );
          }

          if (assignment.symbol === 2) {
            const pendingIdentifiers = arrayLiteral.elements.map((_, index) =>
              factory.createIdentifier(`__wm_p_${assignment.line}_${index}`),
            );

            return factory.createBlock(
              [
                ...arrayLiteral.elements.map((element, index) =>
                  factory.createVariableStatement(
                    undefined,
                    factory.createVariableDeclarationList(
                      [
                        factory.createVariableDeclaration(
                          pendingIdentifiers[index],
                          undefined,
                          undefined,
                          element,
                        ),
                      ],
                      ts.NodeFlags.Const,
                    ),
                  ),
                ),
                factory.createVariableStatement(
                  node.modifiers,
                  factory.createVariableDeclarationList(
                    [
                      factory.createVariableDeclaration(
                        declaration.name,
                        undefined,
                        undefined,
                        factory.createAwaitExpression(
                          factory.createCallExpression(
                            factory.createPropertyAccessExpression(
                              factory.createIdentifier("Promise"),
                              factory.createIdentifier("all"),
                            ),
                            undefined,
                            [
                              factory.createArrayLiteralExpression(
                                pendingIdentifiers,
                                false,
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                    node.declarationList.flags,
                  ),
                ),
              ],
              true,
            );
          }

          if (assignment.symbol === 3) {
            const resultsIdentifier = factory.createIdentifier(`__wm_results_${assignment.line}`);

            return factory.createBlock(
              [
                factory.createVariableStatement(
                  undefined,
                  factory.createVariableDeclarationList(
                    [
                      factory.createVariableDeclaration(
                        resultsIdentifier,
                        undefined,
                        undefined,
                        factory.createAwaitExpression(
                          factory.createCallExpression(
                            factory.createPropertyAccessExpression(
                              factory.createIdentifier("Promise"),
                              factory.createIdentifier("all"),
                            ),
                            undefined,
                            [factory.createArrayLiteralExpression(arrayLiteral.elements, false)],
                          ),
                        ),
                      ),
                    ],
                    ts.NodeFlags.Const,
                  ),
                ),
                factory.createVariableStatement(
                  node.modifiers,
                  factory.createVariableDeclarationList(
                    [
                      factory.createVariableDeclaration(
                        declaration.name,
                        undefined,
                        undefined,
                        resultsIdentifier,
                      ),
                    ],
                    node.declarationList.flags,
                  ),
                ),
              ],
              true,
            );
          }
        }
      }

      if (
        assignment?.family === "object-literal-assign" &&
        ts.isObjectLiteralExpression(node) &&
        assignment.symbol > 0
      ) {
        return buildObjectAssignExpression(factory, [...node.properties], assignment.symbol);
      }

      return ts.visitEachChild(node, visit, context);
    }

    return (sourceFile) => ts.visitNode(sourceFile, visit);
  };
}

export function collectWatermarkCandidates({
  filePath,
  sourceText,
}) {
  const sourceFile = createSourceFile(filePath, sourceText);
  return filterOverlappingCandidates(collectCandidates(sourceFile));
}

export function applyWatermarkAssignments({
  assignments,
  filePath,
  sourceText,
}) {
  const sourceFile = createSourceFile(filePath, sourceText);
  const fileAssignments = assignments.filter((assignment) => assignment.filePath === filePath);

  if (fileAssignments.length === 0) {
    return sourceText;
  }

  const printer = ts.createPrinter({
    newLine: ts.NewLineKind.LineFeed,
  });
  const transformedSourceFile = ts.transform(sourceFile, [
    createTransformer(fileAssignments),
  ]).transformed[0];

  return printer.printFile(transformedSourceFile);
}
