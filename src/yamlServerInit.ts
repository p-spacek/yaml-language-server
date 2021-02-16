import { Connection, InitializeParams, InitializeResult, TextDocumentSyncKind } from 'vscode-languageserver/node';
import {
  getLanguageService as getCustomLanguageService,
  LanguageService,
  SchemaRequestService,
  WorkspaceContextService,
} from './languageservice/yamlLanguageService';
import { workspaceFoldersChanged } from './languageservice/utils/paths';
import { URI } from 'vscode-uri';
import { SettingsState } from './yamlSettings';
import { LanguageHandlers } from './languageserver/handlers/languageHandlers';
import { NotificationHandlers } from './languageserver/handlers/notificationHandlers';
import { RequestHandlers } from './languageserver/handlers/requestHandlers';
import { ValidationHandler } from './languageserver/handlers/validationHandlers';
import { SettingsHandler } from './languageserver/handlers/settingsHandlers';
import { YamlCommands } from './commands';
import { WorkspaceHandlers } from './languageserver/handlers/workspaceHandlers';
import { commandExecutor } from './languageserver/commandExecutor';

export class YAMLServerInit {
  languageService: LanguageService;
  languageHandler: LanguageHandlers;
  validationHandler: ValidationHandler;

  constructor(
    private readonly connection: Connection,
    private yamlSettings: SettingsState,
    private workspaceContext: WorkspaceContextService,
    private schemaRequestService: SchemaRequestService
  ) {
    this.yamlSettings.documents.listen(this.connection);

    /**
     * Run when the client connects to the server after it is activated.
     * The server receives the root path(s) of the workspace and the client capabilities.
     */
    this.connection.onInitialize(
      (params: InitializeParams): InitializeResult => {
        return this.connectionInitialized(params);
      }
    );
    this.connection.onInitialized(() => {
      if (this.yamlSettings.hasWorkspaceFolderCapability) {
        this.connection.workspace.onDidChangeWorkspaceFolders((changedFolders) => {
          this.yamlSettings.workspaceFolders = workspaceFoldersChanged(this.yamlSettings.workspaceFolders, changedFolders);
        });
      }
    });
  }

  // public for test setup
  connectionInitialized(params: InitializeParams): InitializeResult {
    this.yamlSettings.capabilities = params.capabilities;
    this.languageService = getCustomLanguageService(
      this.schemaRequestService,
      this.workspaceContext,
      this.connection,
      params.capabilities
    );

    // Only try to parse the workspace root if its not null. Otherwise initialize will fail
    if (params.rootUri) {
      this.yamlSettings.workspaceRoot = URI.parse(params.rootUri);
    }
    this.yamlSettings.workspaceFolders = params.workspaceFolders || [];

    this.yamlSettings.hierarchicalDocumentSymbolSupport = !!(
      this.yamlSettings.capabilities.textDocument &&
      this.yamlSettings.capabilities.textDocument.documentSymbol &&
      this.yamlSettings.capabilities.textDocument.documentSymbol.hierarchicalDocumentSymbolSupport
    );
    this.yamlSettings.clientDynamicRegisterSupport = !!(
      this.yamlSettings.capabilities.textDocument &&
      this.yamlSettings.capabilities.textDocument.rangeFormatting &&
      this.yamlSettings.capabilities.textDocument.rangeFormatting.dynamicRegistration
    );
    this.yamlSettings.hasWorkspaceFolderCapability =
      this.yamlSettings.capabilities.workspace && !!this.yamlSettings.capabilities.workspace.workspaceFolders;

    this.registerHandlers();

    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: { resolveProvider: false },
        hoverProvider: false,
        documentSymbolProvider: true,
        documentFormattingProvider: false,
        documentOnTypeFormattingProvider: {
          firstTriggerCharacter: '\n',
        },
        documentRangeFormattingProvider: false,
        documentLinkProvider: {},
        foldingRangeProvider: true,
        codeActionProvider: true,
        executeCommandProvider: {
          commands: Object.keys(YamlCommands).map((k) => YamlCommands[k]),
        },
        workspace: {
          workspaceFolders: {
            changeNotifications: true,
            supported: true,
          },
        },
      },
    };
  }

  private registerHandlers(): void {
    // Register all features that the language server has
    this.validationHandler = new ValidationHandler(this.connection, this.languageService, this.yamlSettings);
    const settingsHandler = new SettingsHandler(this.connection, this.languageService, this.yamlSettings, this.validationHandler);
    settingsHandler.registerHandlers();
    this.languageHandler = new LanguageHandlers(this.connection, this.languageService, this.yamlSettings, this.validationHandler);
    this.languageHandler.registerHandlers();
    new NotificationHandlers(this.connection, this.languageService, this.yamlSettings, settingsHandler).registerHandlers();
    new RequestHandlers(this.connection, this.languageService, this.yamlSettings).registerHandlers();
    new WorkspaceHandlers(this.connection, commandExecutor).registerHandlers();
  }

  start(): void {
    this.connection.listen();
  }
}
