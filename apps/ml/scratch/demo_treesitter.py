import tree_sitter_java as tsjava
from tree_sitter import Language, Parser
from sklearn.feature_extraction.text import TfidfVectorizer
import pandas as pd

def extract_comments_from_java(source_code: str, file_path: str = "PaymentProcessor.java"):
    JAVA_LANGUAGE = Language(tsjava.language())
    parser = Parser(JAVA_LANGUAGE)
    
    tree = parser.parse(bytes(source_code, "utf8"))
    root_node = tree.root_node
    
    extracted_comments = []
    
    def traverse(node):
        if "comment" in node.type:
            comment_text = source_code[node.start_byte:node.end_byte]
            extracted_comments.append({
                "file_path": file_path,
                "type": node.type,
                "start_line": node.start_point[0] + 1,
                "end_line": node.end_point[0] + 1,
                "text": comment_text.strip()
            })
        for child in node.children:
            traverse(child)
            
    traverse(root_node)
    return extracted_comments

if __name__ == "__main__":
    sample_java_code = """
    package com.example;

    // TODO: Need to refactor this class to handle async processing
    public class PaymentProcessor {
        private String endpoint = "http://api.example.com//v1"; // False positive check!

        /*
         * FIXME: Temporary workaround for null pointer exception on missing user ID
         */
        public void processPayment(String userId) {
            if (userId == null) {
                return; // Return early
            }
        }
    }
    """

    print("=== 1. TREE-SITTER COMMENT EXTRACTION ===")
    comments = extract_comments_from_java(sample_java_code)
    comment_texts = [c["text"] for c in comments]
    for c in comments:
        print(f"File: {c['file_path']} | Lines {c['start_line']}-{c['end_line']} [{c['type']}]: {c['text']}")

    print("\n=== 2. PIPING TREE-SITTER COMMENTS INTO TF-IDF VECTORIZER ===")
    vectorizer = TfidfVectorizer(stop_words='english')
    tfidf_matrix = vectorizer.fit_transform(comment_texts)
    
    feature_names = vectorizer.get_feature_names_out()
    df_tfidf = pd.DataFrame(tfidf_matrix.toarray(), columns=feature_names, index=[f"Comment {i+1}" for i in range(len(comments))])
    
    print("\nTF-IDF Feature Matrix (Non-Zero Weights):")
    for i, row in df_tfidf.iterrows():
        non_zero = row[row > 0].round(4).to_dict()
        print(f"\n{i} ('{comment_texts[int(i.split()[1])-1]}'):")
        for word, val in non_zero.items():
            print(f"  - {word}: {val}")
